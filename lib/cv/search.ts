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

type ScoredChunkRow = {
  row: CvChunkRow;
  file: CvFileRow;
  score: number;
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
  const textTerms = new Set(tokenize(chunk.chunk_text));
  const file = getCvFile(chunk);
  const metadataTerms = new Set(
    tokenize(
      [file?.original_filename, file?.candidate_name, file?.candidate_email]
        .filter(Boolean)
        .join(" "),
    ),
  );

  return questionTerms.reduce((score, term) => {
    let nextScore = score;

    if (textTerms.has(term)) nextScore += 2;
    if (metadataTerms.has(term)) nextScore += 3;

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

      if (!file) return null;

      return {
        row,
        file,
        score: questionTerms.length > 0 ? scoreChunk(questionTerms, row) : 1,
      };
    })
    .filter((entry): entry is ScoredChunkRow => entry !== null)
    .sort((a, b) => b.score - a.score || a.row.chunk_index - b.row.chunk_index);

  const matchingFileIds = new Set(
    scoredRows.filter((entry) => entry.score > 0).map((entry) => entry.file.id),
  );
  const candidateRows =
    matchingFileIds.size > 0
      ? scoredRows.filter((entry) => matchingFileIds.has(entry.file.id))
      : scoredRows;

  const groupedRows = new Map<
    string,
    {
      fileScore: number;
      entries: ScoredChunkRow[];
    }
  >();

  candidateRows.forEach((entry) => {
    const group = groupedRows.get(entry.file.id) ?? {
      fileScore: 0,
      entries: [],
    };

    group.fileScore = Math.max(group.fileScore, entry.score);
    group.entries.push(entry);
    groupedRows.set(entry.file.id, group);
  });

  const rankedGroups = [...groupedRows.values()]
    .map((group) => ({
      ...group,
      entries: group.entries.sort(
        (a, b) => b.score - a.score || a.row.chunk_index - b.row.chunk_index,
      ),
    }))
    .sort((a, b) => b.fileScore - a.fileScore);

  const diverseRows = rankedGroups.flatMap((group) => group.entries.slice(0, 2));
  const fallbackRows = rankedGroups.flatMap((group) => group.entries.slice(2));
  const bestRows = [...diverseRows, ...fallbackRows].slice(0, resultLimit);

  return bestRows.map<SearchResult>((entry) => ({
    chunkId: entry.row.id,
    cvFileId: entry.row.cv_file_id,
    chunkIndex: entry.row.chunk_index,
    chunkText: entry.row.chunk_text,
    score: entry.score,
    originalFilename: entry.file.original_filename,
    candidateName: entry.file.candidate_name,
    candidateEmail: entry.file.candidate_email,
  }));
}
