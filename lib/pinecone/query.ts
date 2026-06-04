import {
  describePineconeIndex,
  getPineconeNamespace,
  getPineconeApiKey,
  getPineconeIndexName,
} from "@/lib/pinecone/client";

export type PineconeMatch = {
  id: string;
  score: number;
  metadata: Record<string, string | number | boolean | null>;
};

type PineconeQueryResponse = {
  matches?: Array<{
    id: string;
    score?: number;
    metadata?: Record<string, string | number | boolean | null>;
  }>;
};

/**
 * Query Pinecone for the closest vectors to the given query vector.
 * Returns matches sorted by descending relevance score.
 */
export async function queryPinecone(
  queryVector: number[],
  topK = 8,
): Promise<PineconeMatch[]> {
  const index = await describePineconeIndex();

  if (!index.status?.ready) {
    throw new Error(
      `Pinecone index ${index.name} is not ready. Current state: ${index.status?.state ?? "unknown"}.`,
    );
  }

  const response = await fetch(`https://${index.host}/query`, {
    method: "POST",
    headers: {
      "Api-Key": getPineconeApiKey(),
      "Content-Type": "application/json",
      "X-Pinecone-Api-Version": "2025-10",
    },
    body: JSON.stringify({
      namespace: getPineconeNamespace(),
      vector: queryVector,
      topK,
      includeMetadata: true,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Pinecone query failed: ${errorBody}`);
  }

  const data = (await response.json()) as PineconeQueryResponse;

  return (data.matches ?? []).map((match) => ({
    id: match.id,
    score: match.score ?? 0,
    metadata: match.metadata ?? {},
  }));
}
