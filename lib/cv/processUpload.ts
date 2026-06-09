import { randomUUID } from "crypto";

import { chunkCvText } from "@/lib/cv/chunk";
import { extractCvText } from "@/lib/cv/extract";
import { deletePineconeVectors } from "@/lib/pinecone/client";
import { indexCvChunks } from "@/lib/rag/indexChunks";
import { supabaseAdmin } from "@/lib/supabase/admin";

type CvFileRow = {
  id: string;
  original_filename: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  upload_status: string;
  candidate_name: string | null;
  candidate_email: string | null;
};

async function loadCvFile(fileId: string) {
  const { data, error } = await supabaseAdmin
    .from("cv_files")
    .select(
      "id, original_filename, storage_bucket, storage_path, mime_type, upload_status, candidate_name, candidate_email",
    )
    .eq("id", fileId)
    .single();

  if (error || !data) {
    throw new Error(`CV file not found: ${fileId}`);
  }

  return data as CvFileRow;
}

async function clearExistingChunks(fileId: string) {
  const { data: existingChunks, error: existingChunksError } = await supabaseAdmin
    .from("cv_chunks")
    .select("id, pinecone_vector_id")
    .eq("cv_file_id", fileId);

  if (existingChunksError) {
    throw new Error(`Failed to load existing CV chunks: ${existingChunksError.message}`);
  }

  const vectorIds = (existingChunks ?? [])
    .map((chunk) => chunk.pinecone_vector_id)
    .filter(Boolean);

  if (vectorIds.length > 0) {
    await deletePineconeVectors(vectorIds);
  }

  const { error: deleteChunksError } = await supabaseAdmin
    .from("cv_chunks")
    .delete()
    .eq("cv_file_id", fileId);

  if (deleteChunksError) {
    throw new Error(`Failed to clear existing CV chunks: ${deleteChunksError.message}`);
  }
}

async function markFailed(
  fileId: string,
  processingError: string,
  extractedText = "",
  chunkCount = 0,
) {
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

export async function processUploadedCv(fileId: string) {
  let extractedText = "";
  let chunkCount = 0;
  let insertedChunkIds: string[] = [];
  let insertedVectorIds: string[] = [];

  try {
    const cvFile = await loadCvFile(fileId);

    if (cvFile.upload_status === "ready") {
      return { status: "ready" as const, chunkCount: null };
    }

    await supabaseAdmin
      .from("cv_files")
      .update({
        upload_status: "processing",
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", fileId);

    await clearExistingChunks(fileId);

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from(cvFile.storage_bucket)
      .download(cvFile.storage_path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download CV file: ${downloadError?.message ?? "Unknown error"}`);
    }

    const fileBuffer = Buffer.from(await fileData.arrayBuffer());

    extractedText = await extractCvText({
      buffer: fileBuffer,
      filename: cvFile.original_filename,
      mimeType: cvFile.mime_type,
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

    insertedChunkIds = chunkRows.map((chunk) => chunk.id);
    insertedVectorIds = chunkRows.map((chunk) => chunk.pinecone_vector_id);

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
          originalFilename: cvFile.original_filename,
          candidateName: cvFile.candidate_name,
          candidateEmail: cvFile.candidate_email,
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

    return { status: "ready" as const, chunkCount };
  } catch (error) {
    if (insertedChunkIds.length > 0) {
      await supabaseAdmin.from("cv_chunks").delete().in("id", insertedChunkIds);
    }

    if (insertedVectorIds.length > 0) {
      try {
        await deletePineconeVectors(insertedVectorIds);
      } catch (cleanupError) {
        console.error("Failed to clean up Pinecone vectors after processing error:", cleanupError);
      }
    }

    const message =
      error instanceof Error ? error.message : "CV processing failed.";

    await markFailed(fileId, message, extractedText, chunkCount);
    throw error;
  }
}
