import mammoth from "mammoth";
import path from "path";
import { createWorker } from "tesseract.js";

const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
  buffer: Buffer,
) => Promise<{ text: string }>;

const OCR_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
const OCR_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const PDF_OCR_RENDER_SCALE = 1.25;
const MAX_PDF_OCR_PAGES = 2;
const MIN_OCR_TEXT_LENGTH = 800;

let ocrWorkerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;

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

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker("eng", 1, {
      workerPath: path.join(
        process.cwd(),
        "node_modules",
        "tesseract.js",
        "src",
        "worker-script",
        "node",
        "index.js",
      ),
      cachePath: path.join(process.cwd(), ".cache", "tesseract"),
    });
  }

  return ocrWorkerPromise;
}

async function extractImageTextWithOcr(buffer: Buffer) {
  const worker = await getOcrWorker();
  const result = await worker.recognize(buffer);
  return result.data.text;
}

async function loadPdfForOcr(buffer: Buffer) {
  const runtimeRequire = eval("require") as NodeRequire;
  const {
    createCanvas,
    DOMMatrix,
    ImageData,
    Path2D,
  } = runtimeRequire("@napi-rs/canvas") as typeof import("@napi-rs/canvas");

  if (typeof globalThis.DOMMatrix === "undefined") {
    (globalThis as Record<string, unknown>).DOMMatrix = DOMMatrix;
  }

  if (typeof globalThis.ImageData === "undefined") {
    (globalThis as Record<string, unknown>).ImageData = ImageData;
  }

  if (typeof globalThis.Path2D === "undefined") {
    (globalThis as Record<string, unknown>).Path2D = Path2D;
  }

  if (!(globalThis as Record<string, unknown>).pdfjsWorker) {
    const pdfWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as Record<string, unknown>).pdfjsWorker = {
      WorkerMessageHandler: pdfWorker.WorkerMessageHandler,
    };
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });

  return {
    createCanvas,
    loadingTask,
  };
}

async function extractPdfTextWithOcr(buffer: Buffer) {
  const { createCanvas, loadingTask } = await loadPdfForOcr(buffer);
  const pdf = await loadingTask.promise;
  const ocrTexts: string[] = [];
  let totalLength = 0;

  try {
    const totalPages = Math.min(pdf.numPages, MAX_PDF_OCR_PAGES);

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: PDF_OCR_RENDER_SCALE });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const context = canvas.getContext("2d");

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      const pageText = normalizeExtractedText(
        await extractImageTextWithOcr(canvas.toBuffer("image/png")),
      );

      if (!pageText) {
        continue;
      }

      ocrTexts.push(pageText);
      totalLength += pageText.length;

      if (totalLength >= MIN_OCR_TEXT_LENGTH) {
        break;
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  return normalizeExtractedText(ocrTexts.join("\n\n"));
}

async function extractPdfTextWithOcrFallback(buffer: Buffer) {
  const parsedText = normalizeExtractedText(await extractPdfText(buffer));
  if (parsedText) return parsedText;

  return extractPdfTextWithOcr(buffer);
}

export async function extractCvText({
  buffer,
  filename,
  mimeType,
}: ExtractCvTextInput) {
  const extension = getFileExtension(filename);

  if (mimeType === "application/pdf" || extension === "pdf") {
    return await extractPdfTextWithOcrFallback(buffer);
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return normalizeExtractedText(await extractDocxText(buffer));
  }

  if (OCR_IMAGE_MIME_TYPES.has(mimeType) || OCR_IMAGE_EXTENSIONS.has(extension)) {
    return normalizeExtractedText(await extractImageTextWithOcr(buffer));
  }

  throw new Error(
    "Text extraction is only supported for PDF, DOCX, PNG, JPG, JPEG, and WEBP files.",
  );
}
