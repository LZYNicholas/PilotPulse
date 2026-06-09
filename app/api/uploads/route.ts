import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { chunkCvText } from "@/lib/cv/chunk";
import { extractCvText } from "@/lib/cv/extract";
import { indexCvChunks } from "@/lib/rag/indexChunks";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getFileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function createSafeStorageFilename(filename: string) {
  const extension = getFileExtension(filename);
  const basename = filename
    .replace(/\.[^/.]+$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();

  const safeBasename = basename || "cv";
  return extension ? `${safeBasename}.${extension}` : safeBasename;
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("cv_files")
    .select(
      "id, original_filename, storage_path, file_size_bytes, mime_type, upload_status, uploaded_at, candidate_name, candidate_email",
    )
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: `Failed to load CVs: ${error.message}` },
      { status: 500 },
    );
  }

  const files = await Promise.all(
    data.map(async (file) => {
      const { data: signedUrlData } = await supabaseAdmin.storage
        .from("cv-uploads")
        .createSignedUrl(file.storage_path, 60 * 60);

      return {
        id: file.id,
        originalFilename: file.original_filename,
        fileSizeBytes: file.file_size_bytes,
        mimeType: file.mime_type,
        uploadStatus: file.upload_status,
        uploadedAt: file.uploaded_at,
        candidateName: file.candidate_name,
        candidateEmail: file.candidate_email,
        fileUrl: signedUrlData?.signedUrl ?? null,
      };
    }),
  );

  return NextResponse.json({ files });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const fileEntries = formData.getAll("files");

  if (fileEntries.length === 0) {
    return NextResponse.json({ error: "No files were provided." }, { status: 400 });
  }

  const files = fileEntries.filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No valid file objects were provided." }, { status: 400 });
  }

  const uploadedRecords: Array<{
    id: string;
    originalFilename: string;
    storagePath: string;
    fileSizeBytes: number;
    mimeType: string;
    uploadStatus: string;
    fileUrl: string | null;
  }> = [];

  for (const file of files) {
    const extension = getFileExtension(file.name);

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { error: `${file.name} is not a supported file type. Use PDF or DOCX.` },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `${file.name} has an unsupported MIME type: ${file.type || "unknown"}.` },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `${file.name} exceeds the 10 MB limit.` },
        { status: 400 },
      );
    }

    const fileId = randomUUID();
    const storagePath = `${fileId}/${createSafeStorageFilename(file.name)}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const { error: storageError } = await supabaseAdmin.storage
      .from("cv-uploads")
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (storageError) {
      return NextResponse.json(
        { error: `Failed to upload ${file.name}: ${storageError.message}` },
        { status: 500 },
      );
    }

    const { data: insertedRow, error: insertError } = await supabaseAdmin
      .from("cv_files")
      .insert({
        id: fileId,
        original_filename: file.name,
        storage_bucket: "cv-uploads",
        storage_path: storagePath,
        mime_type: file.type,
        file_size_bytes: file.size,
        upload_status: "processing",
      })
      .select("id, original_filename, storage_path, file_size_bytes, mime_type, upload_status")
      .single();

    if (insertError) {
      await supabaseAdmin.storage.from("cv-uploads").remove([storagePath]);

      return NextResponse.json(
        { error: `Failed to save metadata for ${file.name}: ${insertError.message}` },
        { status: 500 },
      );
    }

    let extractedText = "";
    let chunkCount = 0;
    let uploadStatus = "ready";

    try {
      extractedText = await extractCvText({
        buffer: fileBuffer,
        filename: file.name,
        mimeType: file.type,
      });

      if (!extractedText) {
        throw new Error("No text could be extracted from this CV.");
      }

      const chunks = chunkCvText(extractedText, fileId);
      chunkCount = chunks.length;
      const chunkRows = chunks.map((chunk) => ({
        id: randomUUID(),
        cv_file_id: fileId,
        chunk_index: chunk.chunkIndex,
        chunk_text: chunk.chunkText,
        token_count: chunk.tokenCount,
        char_count: chunk.charCount,
        pinecone_vector_id: chunk.pineconeVectorId,
      }));

      if (chunkRows.length > 0) {
        const { error: chunkInsertError } = await supabaseAdmin
          .from("cv_chunks")
          .insert(chunkRows);

        if (chunkInsertError) {
          throw new Error(`Failed to save CV chunks: ${chunkInsertError.message}`);
        }

        await indexCvChunks({
          cvFile: {
            id: fileId,
            originalFilename: file.name,
          },
          chunks: chunkRows.map((chunk) => ({
            id: chunk.id,
            cvFileId: chunk.cv_file_id,
            chunkIndex: chunk.chunk_index,
            chunkText: chunk.chunk_text,
            pineconeVectorId: chunk.pinecone_vector_id,
          })),
        });
      }

      const { error: readyUpdateError } = await supabaseAdmin
        .from("cv_files")
        .update({
          upload_status: "ready",
          extracted_text: extractedText,
          extracted_text_char_count: extractedText.length,
          chunk_count: chunkCount,
          processing_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", fileId);

      if (readyUpdateError) {
        throw new Error(`Failed to save extracted text: ${readyUpdateError.message}`);
      }
    } catch (error) {
      uploadStatus = "failed";

      const processingError =
        error instanceof Error ? error.message : "CV processing failed.";

      await supabaseAdmin
        .from("cv_files")
        .update({
          upload_status: "failed",
          processing_error: processingError,
          extracted_text: extractedText || null,
          extracted_text_char_count: extractedText.length,
          chunk_count: chunkCount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", fileId);
    }

    const { data: signedUrlData } = await supabaseAdmin.storage
      .from("cv-uploads")
      .createSignedUrl(storagePath, 60 * 60);

    uploadedRecords.push({
      id: insertedRow.id,
      originalFilename: insertedRow.original_filename,
      storagePath: insertedRow.storage_path,
      fileSizeBytes: insertedRow.file_size_bytes,
      mimeType: insertedRow.mime_type,
      uploadStatus,
      fileUrl: signedUrlData?.signedUrl ?? null,
    });
  }

  return NextResponse.json({ files: uploadedRecords }, { status: 201 });
}
