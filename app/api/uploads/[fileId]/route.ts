import { NextResponse } from "next/server";

import { deletePineconeVectors } from "@/lib/pinecone/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { fileId } = await context.params;

  const { data: cvFile, error } = await supabaseAdmin
    .from("cv_files")
    .select(
      "id, original_filename, storage_path, file_size_bytes, mime_type, upload_status, uploaded_at, candidate_name, candidate_email, processing_error, extracted_text_char_count, chunk_count",
    )
    .eq("id", fileId)
    .single();

  if (error || !cvFile) {
    return NextResponse.json({ error: "CV not found." }, { status: 404 });
  }

  const { data: signedUrlData } = await supabaseAdmin.storage
    .from("cv-uploads")
    .createSignedUrl(cvFile.storage_path, 60 * 60);

  return NextResponse.json({
    file: {
      id: cvFile.id,
      originalFilename: cvFile.original_filename,
      fileSizeBytes: cvFile.file_size_bytes,
      mimeType: cvFile.mime_type,
      uploadStatus: cvFile.upload_status,
      uploadedAt: cvFile.uploaded_at,
      candidateName: cvFile.candidate_name,
      candidateEmail: cvFile.candidate_email,
      processingError: cvFile.processing_error,
      extractedTextCharCount: cvFile.extracted_text_char_count ?? 0,
      chunkCount: cvFile.chunk_count ?? 0,
      fileUrl: signedUrlData?.signedUrl ?? null,
    },
  });
}

export async function DELETE(_: Request, context: RouteContext) {
  const { fileId } = await context.params;

  const { data: cvFile, error: cvFileError } = await supabaseAdmin
    .from("cv_files")
    .select("id, storage_path")
    .eq("id", fileId)
    .is("deleted_at", null)
    .single();

  if (cvFileError || !cvFile) {
    return NextResponse.json({ error: "CV not found." }, { status: 404 });
  }

  const { data: chunks, error: chunkError } = await supabaseAdmin
    .from("cv_chunks")
    .select("pinecone_vector_id")
    .eq("cv_file_id", fileId);

  if (chunkError) {
    return NextResponse.json(
      { error: `Failed to load CV chunks: ${chunkError.message}` },
      { status: 500 },
    );
  }

  const vectorIds = (chunks ?? [])
    .map((chunk) => chunk.pinecone_vector_id)
    .filter(Boolean);

  try {
    await deletePineconeVectors(vectorIds);
  } catch (error) {
    console.error("Pinecone delete error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Failed to delete Pinecone vectors: ${error.message}`
            : "Failed to delete Pinecone vectors.",
      },
      { status: 502 },
    );
  }

  const { error: storageError } = await supabaseAdmin.storage
    .from("cv-uploads")
    .remove([cvFile.storage_path]);

  if (storageError) {
    return NextResponse.json(
      { error: `Failed to delete CV file: ${storageError.message}` },
      { status: 500 },
    );
  }

  const { error: deleteError } = await supabaseAdmin
    .from("cv_files")
    .delete()
    .eq("id", fileId);

  if (deleteError) {
    return NextResponse.json(
      { error: `Failed to delete CV metadata: ${deleteError.message}` },
      { status: 500 },
    );
  }

  const [{ count: remainingFilesCount, error: verifyFileError }, { count: remainingChunksCount, error: verifyChunkError }] =
    await Promise.all([
      supabaseAdmin
        .from("cv_files")
        .select("id", { count: "exact", head: true })
        .eq("id", fileId),
      supabaseAdmin
        .from("cv_chunks")
        .select("id", { count: "exact", head: true })
        .eq("cv_file_id", fileId),
    ]);

  if (verifyFileError || verifyChunkError) {
    return NextResponse.json(
      {
        error: `Delete verification failed: ${
          verifyFileError?.message ?? verifyChunkError?.message ?? "Unknown error."
        }`,
      },
      { status: 500 },
    );
  }

  if ((remainingFilesCount ?? 0) > 0 || (remainingChunksCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Delete verification failed: CV metadata or chunks still remain after deletion.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    deletedCvFileId: fileId,
    deletedChunkCount: chunks?.length ?? 0,
    deletedVectorCount: vectorIds.length,
  });
}
