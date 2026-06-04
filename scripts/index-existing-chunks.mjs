import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;

  const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);

  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    process.env[key] ??= value;
  }
}

loadLocalEnv();

const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
const GEMINI_EMBEDDING_DIMENSION = Number(
  process.env.GEMINI_EMBEDDING_DIMENSION ?? "1024",
);
const PINECONE_API_VERSION = "2025-10";
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE ?? "cv_chunks";
const BATCH_SIZE = Number(process.env.INDEX_CHUNK_BATCH_SIZE ?? "20");

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

async function embedText(text) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": requireEnv("GEMINI_API_KEY"),
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: GEMINI_EMBEDDING_DIMENSION,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini embedding failed: ${await response.text()}`);
  }

  const data = await response.json();
  const values = data.embedding?.values;

  if (!values?.length) {
    throw new Error("Gemini embedding response did not include values.");
  }

  return values;
}

async function describePineconeIndex() {
  const response = await fetch(
    `https://api.pinecone.io/indexes/${encodeURIComponent(requireEnv("PINECONE_INDEX_NAME"))}`,
    {
      headers: {
        "Api-Key": requireEnv("PINECONE_API_KEY"),
        "X-Pinecone-Api-Version": PINECONE_API_VERSION,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to describe Pinecone index: ${await response.text()}`);
  }

  return response.json();
}

async function upsertVectors(indexHost, vectors) {
  const response = await fetch(`https://${indexHost}/vectors/upsert`, {
    method: "POST",
    headers: {
      "Api-Key": requireEnv("PINECONE_API_KEY"),
      "Content-Type": "application/json",
      "X-Pinecone-Api-Version": PINECONE_API_VERSION,
    },
    body: JSON.stringify({
      namespace: PINECONE_NAMESPACE,
      vectors,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to upsert Pinecone vectors: ${await response.text()}`);
  }

  return response.json();
}

function createSnippet(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function compactMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== null && value !== ""),
  );
}

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const index = await describePineconeIndex();

  if (!index.status?.ready) {
    throw new Error(
      `Pinecone index ${index.name} is not ready. Current state: ${index.status?.state ?? "unknown"}.`,
    );
  }

  if (index.dimension !== GEMINI_EMBEDDING_DIMENSION) {
    throw new Error(
      `Pinecone dimension ${index.dimension} does not match Gemini embedding dimension ${GEMINI_EMBEDDING_DIMENSION}.`,
    );
  }

  const { data: chunks, error: chunksError } = await supabase
    .from("cv_chunks")
    .select("id, cv_file_id, chunk_index, chunk_text, pinecone_vector_id")
    .order("created_at", { ascending: true });

  if (chunksError) throw chunksError;

  if (!chunks || chunks.length === 0) {
    console.log("No cv_chunks rows found.");
    return;
  }

  const cvFileIds = [...new Set(chunks.map((chunk) => chunk.cv_file_id))];
  const { data: cvFiles, error: cvFilesError } = await supabase
    .from("cv_files")
    .select("id, original_filename, candidate_name, candidate_email")
    .in("id", cvFileIds);

  if (cvFilesError) throw cvFilesError;

  const cvFileById = new Map(cvFiles?.map((file) => [file.id, file]) ?? []);
  let indexedCount = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = await Promise.all(
      batch.map(async (chunk) => {
        const cvFile = cvFileById.get(chunk.cv_file_id);

        return {
          id: chunk.pinecone_vector_id,
          values: await embedText(chunk.chunk_text),
          metadata: compactMetadata({
            cv_file_id: chunk.cv_file_id,
            cv_chunk_id: chunk.id,
            chunk_index: chunk.chunk_index,
            original_filename: cvFile?.original_filename ?? "Unknown CV",
            candidate_name: cvFile?.candidate_name ?? null,
            candidate_email: cvFile?.candidate_email ?? null,
            snippet: createSnippet(chunk.chunk_text),
          }),
        };
      }),
    );

    const result = await upsertVectors(index.host, vectors);
    indexedCount += vectors.length;
    console.log(
      `Indexed ${indexedCount}/${chunks.length} chunks. Upserted: ${result.upsertedCount ?? vectors.length}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
