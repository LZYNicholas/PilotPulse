import { getPineconeApiKey } from "@/lib/pinecone/client";

const PINECONE_API_VERSION = "2025-10";
const PINECONE_SPARSE_MODEL =
  process.env.PINECONE_SPARSE_MODEL ?? "pinecone-sparse-english-v0";

export type PineconeSparseVector = {
  indices: number[];
  values: number[];
};

type PineconeSparseEmbeddingResponse = {
  data?: Array<{
    sparse_indices?: number[];
    sparse_values?: number[];
  }>;
};

export async function embedSparseText(
  text: string,
  inputType: "query" | "passage",
): Promise<PineconeSparseVector> {
  const response = await fetch("https://api.pinecone.io/embed", {
    method: "POST",
    headers: {
      "Api-Key": getPineconeApiKey(),
      "Content-Type": "application/json",
      "X-Pinecone-Api-Version": PINECONE_API_VERSION,
    },
    body: JSON.stringify({
      model: PINECONE_SPARSE_MODEL,
      inputs: [{ text }],
      parameters: {
        input_type: inputType,
        truncate: "END",
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Pinecone sparse embedding failed: ${errorBody}`);
  }

  const data = (await response.json()) as PineconeSparseEmbeddingResponse;
  const embedding = data.data?.[0];

  if (
    !embedding ||
    !embedding.sparse_indices?.length ||
    !embedding.sparse_values?.length
  ) {
    throw new Error(
      "Pinecone sparse embedding response did not include sparse values.",
    );
  }

  return {
    indices: embedding.sparse_indices,
    values: embedding.sparse_values,
  };
}
