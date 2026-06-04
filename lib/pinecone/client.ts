const PINECONE_API_VERSION = "2025-10";

type PineconeIndexDescription = {
  name: string;
  host: string;
  dimension: number;
  metric: string;
  status?: {
    ready?: boolean;
    state?: string;
  };
};

export type PineconeVector = {
  id: string;
  values: number[];
  metadata?: Record<string, string | number | boolean | null>;
};

let cachedIndexDescription: PineconeIndexDescription | null = null;

function getPineconeApiKey() {
  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    throw new Error("PINECONE_API_KEY is not configured.");
  }

  return apiKey;
}

export function getPineconeIndexName() {
  const indexName = process.env.PINECONE_INDEX_NAME;

  if (!indexName) {
    throw new Error("PINECONE_INDEX_NAME is not configured.");
  }

  return indexName;
}

export function getPineconeNamespace() {
  return process.env.PINECONE_NAMESPACE ?? "cv_chunks";
}

export async function describePineconeIndex() {
  if (cachedIndexDescription) return cachedIndexDescription;

  const response = await fetch(
    `https://api.pinecone.io/indexes/${encodeURIComponent(getPineconeIndexName())}`,
    {
      headers: {
        "Api-Key": getPineconeApiKey(),
        "X-Pinecone-Api-Version": PINECONE_API_VERSION,
      },
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to describe Pinecone index: ${errorBody}`);
  }

  cachedIndexDescription = (await response.json()) as PineconeIndexDescription;
  return cachedIndexDescription;
}

export async function upsertPineconeVectors(vectors: PineconeVector[]) {
  if (vectors.length === 0) return { upsertedCount: 0 };

  const index = await describePineconeIndex();

  if (!index.status?.ready) {
    throw new Error(
      `Pinecone index ${index.name} is not ready. Current state: ${index.status?.state ?? "unknown"}.`,
    );
  }

  const mismatchedVector = vectors.find(
    (vector) => vector.values.length !== index.dimension,
  );

  if (mismatchedVector) {
    throw new Error(
      `Vector ${mismatchedVector.id} has dimension ${mismatchedVector.values.length}, but Pinecone index ${index.name} expects ${index.dimension}.`,
    );
  }

  const response = await fetch(`https://${index.host}/vectors/upsert`, {
    method: "POST",
    headers: {
      "Api-Key": getPineconeApiKey(),
      "Content-Type": "application/json",
      "X-Pinecone-Api-Version": PINECONE_API_VERSION,
    },
    body: JSON.stringify({
      namespace: getPineconeNamespace(),
      vectors,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to upsert Pinecone vectors: ${errorBody}`);
  }

  return (await response.json()) as { upsertedCount?: number };
}
