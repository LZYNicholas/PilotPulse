import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "png", "jpg", "jpeg", "webp"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
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
      "id, original_filename, storage_path, file_size_bytes, mime_type, upload_status, uploaded_at, candidate_name, candidate_email, processing_error",
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
        processingError: file.processing_error ?? null,
      };
    }),
  );

  return NextResponse.json({ files });
}

export async function POST(request: Request) {
  try {
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
      processingError: string | null;
    }> = [];

    for (const file of files) {
      const extension = getFileExtension(file.name);

      if (!ALLOWED_EXTENSIONS.has(extension)) {
        return NextResponse.json(
          {
            error: `${file.name} is not a supported file type. Use PDF, DOCX, PNG, JPG, JPEG, or WEBP.`,
          },
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
          upload_status: "uploaded",
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

      const { data: signedUrlData } = await supabaseAdmin.storage
        .from("cv-uploads")
        .createSignedUrl(storagePath, 60 * 60);

      uploadedRecords.push({
        id: insertedRow.id,
        originalFilename: insertedRow.original_filename,
        storagePath: insertedRow.storage_path,
        fileSizeBytes: insertedRow.file_size_bytes,
        mimeType: insertedRow.mime_type,
        uploadStatus: insertedRow.upload_status,
        fileUrl: signedUrlData?.signedUrl ?? null,
        processingError: null,
      });
    }

    return NextResponse.json({ files: uploadedRecords }, { status: 201 });
  } catch (error) {
    console.error("Upload route error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Upload failed due to an unexpected server error.",
      },
      { status: 500 },
    );
  }
}
