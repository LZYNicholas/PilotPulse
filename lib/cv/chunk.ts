const DEFAULT_CHUNK_SIZE = 1600;
const DEFAULT_CHUNK_OVERLAP = 200;

export type CvChunk = {
  chunkIndex: number;
  chunkText: string;
  charCount: number;
  tokenCount: number;
  pineconeVectorId: string;
};

function estimateTokenCount(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(words, Math.ceil(text.length / 4));
}

function findChunkEnd(text: string, targetEnd: number, start: number) {
  if (targetEnd >= text.length) return text.length;

  const sentenceEnd = Math.max(
    text.lastIndexOf(". ", targetEnd),
    text.lastIndexOf("\n", targetEnd),
  );

  if (sentenceEnd > start + DEFAULT_CHUNK_SIZE * 0.6) {
    return sentenceEnd + 1;
  }

  const spaceEnd = text.lastIndexOf(" ", targetEnd);
  return spaceEnd > start ? spaceEnd : targetEnd;
}

export function chunkCvText(
  text: string,
  cvFileId: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP,
) {
  const chunks: CvChunk[] = [];
  const normalizedText = text.trim();

  if (!normalizedText) return chunks;

  let start = 0;

  while (start < normalizedText.length) {
    const end = findChunkEnd(normalizedText, start + chunkSize, start);
    const chunkText = normalizedText.slice(start, end).trim();

    if (chunkText) {
      chunks.push({
        chunkIndex: chunks.length,
        chunkText,
        charCount: chunkText.length,
        tokenCount: estimateTokenCount(chunkText),
        pineconeVectorId: `${cvFileId}:${chunks.length}`,
      });
    }

    if (end >= normalizedText.length) break;

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
