import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_CHUNKS_TO_SCORE = 250;
const DEFAULT_RESULT_LIMIT = 8;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
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
  "it",
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

type CvFileRow = {
  id: string;
  original_filename: string;
  candidate_name: string | null;
  candidate_email: string | null;
};

type CvChunkRow = {
  id: string;
  cv_file_id: string;
  chunk_index: number;
  chunk_text: string;
  token_count: number | null;
  char_count: number;
  cv_files: CvFileRow | CvFileRow[] | null;
};

export type SearchResult = {
  chunkId: string;
  cvFileId: string;
  chunkIndex: number;
  chunkText: string;
  score: number;
  originalFilename: string;
  candidateName: string | null;
  candidateEmail: string | null;
};

function tokenize(text: string) {
  return text
    .toLowerCase()
    .match(/[a-z0-9+#.-]+/g)
    ?.filter((term) => term.length > 1 && !STOP_WORDS.has(term)) ?? [];
}

function getCvFile(row: CvChunkRow) {
  if (Array.isArray(row.cv_files)) return row.cv_files[0] ?? null;
  return row.cv_files;
}

function scoreChunk(questionTerms: string[], chunk: CvChunkRow) {
  const text = chunk.chunk_text.toLowerCase();
  const file = getCvFile(chunk);
  const metadata = [
    file?.original_filename,
    file?.candidate_name,
    file?.candidate_email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return questionTerms.reduce((score, term) => {
    let nextScore = score;

    if (text.includes(term)) nextScore += 2;
    if (metadata.includes(term)) nextScore += 3;

    return nextScore;
  }, 0);
}

export async function searchCvChunks(
  question: string,
  resultLimit = DEFAULT_RESULT_LIMIT,
) {
  const questionTerms = tokenize(question);

  const { data, error } = await supabaseAdmin
    .from("cv_chunks")
    .select(
      `
      id,
      cv_file_id,
      chunk_index,
      chunk_text,
      token_count,
      char_count,
      cv_files!inner (
        id,
        original_filename,
        candidate_name,
        candidate_email
      )
    `,
    )
    .eq("cv_files.upload_status", "ready")
    .is("cv_files.deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_CHUNKS_TO_SCORE);

  if (error) {
    throw new Error(`Failed to search CV chunks: ${error.message}`);
  }

  const rows = (data ?? []) as CvChunkRow[];
  const scoredRows = rows
    .map((row) => {
      const file = getCvFile(row);

      return {
        row,
        file,
        score: questionTerms.length > 0 ? scoreChunk(questionTerms, row) : 1,
      };
    })
    .filter((entry) => entry.file)
    .sort((a, b) => b.score - a.score || a.row.chunk_index - b.row.chunk_index);

  const bestRows =
    scoredRows.some((entry) => entry.score > 0)
      ? scoredRows.filter((entry) => entry.score > 0)
      : scoredRows;

  return bestRows.slice(0, resultLimit).map<SearchResult>((entry) => ({
    chunkId: entry.row.id,
    cvFileId: entry.row.cv_file_id,
    chunkIndex: entry.row.chunk_index,
    chunkText: entry.row.chunk_text,
    score: entry.score,
    originalFilename: entry.file?.original_filename ?? "Unknown CV",
    candidateName: entry.file?.candidate_name ?? null,
    candidateEmail: entry.file?.candidate_email ?? null,
  }));
}
