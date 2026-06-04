import type { HybridSearchResult } from "@/lib/rag/hybridSearch";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "did",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "who",
  "with",
]);

export type RerankInput = HybridSearchResult & {
  chunkText: string;
  candidateName: string;
  filename: string;
};

export type RerankedSearchResult = RerankInput & {
  rerankScore: number;
};

function tokenize(text: string) {
  return (
    text
      .toLowerCase()
      .match(/[a-z0-9+#.-]+/g)
      ?.filter((term) => term.length > 1 && !STOP_WORDS.has(term)) ?? []
  );
}

function lexicalScore(question: string, candidate: RerankInput) {
  const queryTerms = new Set(tokenize(question));
  if (queryTerms.size === 0) return 0;

  const searchableText = [
    candidate.chunkText,
    candidate.candidateName,
    candidate.filename,
  ].join(" ");
  const textTerms = new Set(tokenize(searchableText));
  const matchedTerms = [...queryTerms].filter((term) => textTerms.has(term));
  const termScore = matchedTerms.length / queryTerms.size;
  const phraseBonus = searchableText
    .toLowerCase()
    .includes(question.toLowerCase().trim())
    ? 0.2
    : 0;

  return Math.min(termScore + phraseBonus, 1);
}

export function rerankHybridResults({
  question,
  candidates,
  limit,
}: {
  question: string;
  candidates: RerankInput[];
  limit: number;
}) {
  return candidates
    .map<RerankedSearchResult>((candidate) => {
      const rerankScore =
        candidate.score * 0.7 + lexicalScore(question, candidate) * 0.3;

      return {
        ...candidate,
        rerankScore,
      };
    })
    .sort(
      (a, b) =>
        b.rerankScore - a.rerankScore ||
        b.score - a.score ||
        (b.denseScore ?? 0) - (a.denseScore ?? 0),
    )
    .slice(0, limit);
}
