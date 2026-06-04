const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
const GEMINI_EMBEDDING_DIMENSION = Number(
  process.env.GEMINI_EMBEDDING_DIMENSION ?? "1024",
);

type GeminiEmbeddingResponse = {
  embedding?: {
    values?: number[];
  };
};

export type GeminiEmbeddingTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING";

export function getEmbeddingDimension() {
  return GEMINI_EMBEDDING_DIMENSION;
}

export async function embedText(
  text: string,
  taskType: GeminiEmbeddingTaskType = "RETRIEVAL_DOCUMENT",
) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
        taskType,
        outputDimensionality: GEMINI_EMBEDDING_DIMENSION,
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini embedding failed: ${errorBody}`);
  }

  const data = (await response.json()) as GeminiEmbeddingResponse;
  const values = data.embedding?.values;

  if (!values || values.length === 0) {
    throw new Error("Gemini embedding response did not include values.");
  }

  if (values.length !== GEMINI_EMBEDDING_DIMENSION) {
    throw new Error(
      `Gemini embedding dimension ${values.length} does not match configured dimension ${GEMINI_EMBEDDING_DIMENSION}.`,
    );
  }

  return values;
}
