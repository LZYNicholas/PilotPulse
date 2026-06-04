import { embedSparseText } from "@/lib/pinecone/inference";
import { queryPinecone } from "@/lib/pinecone/query";

const DEFAULT_ALPHA = 0.5;

export type HybridSearchResult = {
  id: string;
  score: number;
  denseScore?: number;
  sparseScore?: number;
};

function clampAlpha(alpha: number | undefined) {
  if (alpha === undefined || Number.isNaN(alpha)) return DEFAULT_ALPHA;
  return Math.min(Math.max(alpha, 0), 1);
}

function scaleDenseVector(queryVector: number[], alpha: number) {
  return queryVector.map((value) => value * alpha);
}

function scaleSparseVector(
  sparseVector: Awaited<ReturnType<typeof embedSparseText>>,
  alpha: number,
) {
  return {
    indices: sparseVector.indices,
    values: sparseVector.values.map((value) => value * (1 - alpha)),
  };
}

export async function hybridSearchCvChunks({
  question,
  queryVector,
  topK,
  alpha,
}: {
  question: string;
  queryVector: number[];
  topK: number;
  alpha?: number;
}) {
  const resolvedAlpha = clampAlpha(alpha);
  const sparseQueryVector = await embedSparseText(question, "query");
  const matches = await queryPinecone(
    scaleDenseVector(queryVector, resolvedAlpha),
    topK,
    scaleSparseVector(sparseQueryVector, resolvedAlpha),
  );

  return matches.map<HybridSearchResult>((match) => ({
    id: match.id,
    score: Math.max(match.score, 0),
  }));
}
