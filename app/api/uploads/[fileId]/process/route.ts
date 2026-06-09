import { NextResponse } from "next/server";

import { processUploadedCv } from "@/lib/cv/processUpload";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { fileId } = await context.params;

  const { data: cvFile, error } = await supabaseAdmin
    .from("cv_files")
    .select("id, upload_status")
    .eq("id", fileId)
    .single();

  if (error || !cvFile) {
    return NextResponse.json({ error: "CV not found." }, { status: 404 });
  }

  if (cvFile.upload_status === "ready") {
    return NextResponse.json({ success: true, uploadStatus: "ready" });
  }

  try {
    await processUploadedCv(fileId);
    return NextResponse.json({ success: true, uploadStatus: "ready" });
  } catch (processingError) {
    console.error("Background CV processing error:", processingError);
    return NextResponse.json({
      success: false,
      uploadStatus: "failed",
      error:
        processingError instanceof Error
          ? processingError.message
          : "CV processing failed.",
    });
  }
}
