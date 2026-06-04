import { embedText } from "@/lib/ai/embeddings";
import { upsertPineconeVectors } from "@/lib/pinecone/client";

export type ChunkForIndexing = {
  id?: string;
  cvFileId: string;
  chunkIndex: number;
  chunkText: string;
  pineconeVectorId: string;
};

export type CvFileForIndexing = {
  id: string;
  originalFilename: string;
  candidateName?: string | null;
  candidateEmail?: string | null;
};

type IndexCvChunksInput = {
  chunks: ChunkForIndexing[];
  cvFile: CvFileForIndexing;
};

function createSnippet(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function compactMetadata(metadata: Record<string, string | number | boolean | null>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== null && value !== ""),
  ) as Record<string, string | number | boolean>;
}

export async function indexCvChunks({ chunks, cvFile }: IndexCvChunksInput) {
  if (chunks.length === 0) return { upsertedCount: 0 };

  const vectors = await Promise.all(
    chunks.map(async (chunk) => ({
      id: chunk.pineconeVectorId,
      values: await embedText(chunk.chunkText, "RETRIEVAL_DOCUMENT"),
      metadata: compactMetadata({
        cv_file_id: chunk.cvFileId,
        cv_chunk_id: chunk.id ?? null,
        chunk_index: chunk.chunkIndex,
        original_filename: cvFile.originalFilename,
        candidate_name: cvFile.candidateName ?? null,
        candidate_email: cvFile.candidateEmail ?? null,
        snippet: createSnippet(chunk.chunkText),
      }),
    })),
  );

  return upsertPineconeVectors(vectors);
}
