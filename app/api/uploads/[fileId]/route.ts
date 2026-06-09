import { NextResponse } from "next/server";

import { deletePineconeVectors } from "@/lib/pinecone/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

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
