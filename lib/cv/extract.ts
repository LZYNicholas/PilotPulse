import mammoth from "mammoth";

const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer,
) => Promise<{ text: string }>;

type ExtractCvTextInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

function getFileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function normalizeExtractedText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function extractPdfText(buffer: Buffer) {
  const result = await pdfParse(buffer);
  return result.text;
}

async function extractDocxText(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

export async function extractCvText({
  buffer,
  filename,
  mimeType,
}: ExtractCvTextInput) {
  const extension = getFileExtension(filename);

  if (mimeType === "application/pdf" || extension === "pdf") {
    return normalizeExtractedText(await extractPdfText(buffer));
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return normalizeExtractedText(await extractDocxText(buffer));
  }

  throw new Error("Text extraction is only supported for PDF and DOCX files.");
}
