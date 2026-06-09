import fs from "fs";
import path from "path";

import { createClient } from "@supabase/supabase-js";

const ENV_PATH = path.join(process.cwd(), ".env.local");
const PINECONE_API_VERSION = "2025-10";
const STORAGE_BUCKET = "cv-uploads";
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE ?? "cv_chunks";

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`Could not find ${ENV_PATH}`);
  }

  const content = fs.readFileSync(ENV_PATH, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

loadEnvFile();

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

async function deleteAllPineconeVectors() {
  const index = await describePineconeIndex();

  if (!index.status?.ready) {
    throw new Error(
      `Pinecone index ${index.name} is not ready. Current state: ${index.status?.state ?? "unknown"}.`,
    );
  }

  const response = await fetch(`https://${index.host}/vectors/delete`, {
    method: "POST",
    headers: {
      "Api-Key": requireEnv("PINECONE_API_KEY"),
      "Content-Type": "application/json",
      "X-Pinecone-Api-Version": PINECONE_API_VERSION,
    },
    body: JSON.stringify({
      namespace: PINECONE_NAMESPACE,
      deleteAll: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to clear Pinecone namespace: ${await response.text()}`);
  }
}

async function listAllStoragePaths(bucket, currentPath = "") {
  const collected = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(currentPath, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw new Error(`Failed to list storage path "${currentPath}": ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const entry of data) {
      const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

      if (entry.id === null && entry.metadata === null) {
        const nestedPaths = await listAllStoragePaths(bucket, entryPath);
        collected.push(...nestedPaths);
      } else {
        collected.push(entryPath);
      }
    }

    if (data.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return collected;
}

async function deleteStorageFiles() {
  const paths = await listAllStoragePaths(STORAGE_BUCKET);

  if (paths.length === 0) {
    return 0;
  }

  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(batch);

    if (error) {
      throw new Error(`Failed to delete storage files: ${error.message}`);
    }
  }

  return paths.length;
}

async function deleteAllRows(table) {
  const { error } = await supabase.from(table).delete().not("id", "is", null);
  if (error) {
    throw new Error(`Failed to clear ${table}: ${error.message}`);
  }
}

async function clearDatabaseRows() {
  const tablesInOrder = [
    "conversation_message_citations",
    "messages",
    "conversations",
    "cv_chunks",
    "cv_files",
  ];

  for (const table of tablesInOrder) {
    await deleteAllRows(table);
  }
}

async function main() {
  console.log("Resetting PilotPulse test data...");

  await deleteAllPineconeVectors();
  console.log(`Cleared Pinecone namespace "${PINECONE_NAMESPACE}".`);

  const deletedFiles = await deleteStorageFiles();
  console.log(`Deleted ${deletedFiles} file(s) from Supabase storage bucket "${STORAGE_BUCKET}".`);

  await clearDatabaseRows();
  console.log("Cleared Supabase database rows.");

  console.log("Reset complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
