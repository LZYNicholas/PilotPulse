import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    cvFileId: string;
    name: string | null;
    phone: string | null;
    email: string | null;
  };

  const { cvFileId, name, phone, email } = body;

  if (!cvFileId) {
    return NextResponse.json(
      { error: "cvFileId is required." },
      { status: 400 },
    );
  }

  if (!name && !phone && !email) {
    return NextResponse.json(
      { error: "At least one contact detail must be provided." },
      { status: 400 },
    );
  }

  const updatePayload: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };

  if (name) updatePayload.candidate_name = name;
  if (phone) updatePayload.candidate_phone = phone;
  if (email) updatePayload.candidate_email = email;

  const { error } = await supabaseAdmin
    .from("cv_files")
    .update(updatePayload)
    .eq("id", cvFileId);

  if (error) {
    console.error("Supabase update error:", error);
    return NextResponse.json(
      { error: `Failed to save contact details: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
