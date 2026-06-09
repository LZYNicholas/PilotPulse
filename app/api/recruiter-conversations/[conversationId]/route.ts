import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type CitationRecord = {
  message_id: string;
  citation_index: number;
  quoted_text: string | null;
  relevance_score: number | null;
  cv_file_id: string;
  cv_chunk_id: string;
  cv_files:
    | {
        original_filename: string;
        candidate_name: string | null;
        storage_path: string;
      }
    | {
        original_filename: string;
        candidate_name: string | null;
        storage_path: string;
      }[]
    | null;
  cv_chunks:
    | {
        chunk_index: number;
      }
    | {
        chunk_index: number;
      }[]
    | null;
};

function firstRow<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function ensureConversationExists(conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id, title, created_at, updated_at, last_message_at")
    .eq("id", conversationId)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function GET(_: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const conversation = await ensureConversationExists(conversationId);

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 },
    );
  }

  const { data: messages, error: messagesError } = await supabaseAdmin
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json(
      { error: `Failed to load messages: ${messagesError.message}` },
      { status: 500 },
    );
  }

  const messageIds = (messages ?? []).map((message) => message.id);

  const { data: citations, error: citationsError } =
    messageIds.length > 0
      ? await supabaseAdmin
          .from("conversation_message_citations")
          .select(
            "message_id, citation_index, quoted_text, relevance_score, cv_file_id, cv_chunk_id, cv_files(original_filename, candidate_name, storage_path), cv_chunks(chunk_index)",
          )
          .in("message_id", messageIds)
          .order("citation_index", { ascending: true })
      : { data: [], error: null };

  if (citationsError) {
    return NextResponse.json(
      { error: `Failed to load citations: ${citationsError.message}` },
      { status: 500 },
    );
  }

  const signedUrlCache = new Map<string, string | null>();
  const citationsByMessageId = new Map<
    string,
    Array<{
      cvFileId: string;
      filename: string;
      candidateName: string;
      chunkIndex: number;
      snippet: string;
      fileUrl: string | null;
      score: number;
      rerankScore: number;
    }>
  >();

  for (const record of (citations ?? []) as CitationRecord[]) {
    const cvFile = firstRow(record.cv_files);
    const cvChunk = firstRow(record.cv_chunks);
    if (!cvFile || !cvChunk) continue;

    let fileUrl = signedUrlCache.get(record.cv_file_id) ?? null;

    if (!signedUrlCache.has(record.cv_file_id)) {
      const { data: signedUrlData } = await supabaseAdmin.storage
        .from("cv-uploads")
        .createSignedUrl(cvFile.storage_path, 60 * 60);
      fileUrl = signedUrlData?.signedUrl ?? null;
      signedUrlCache.set(record.cv_file_id, fileUrl);
    }

    const messageCitations = citationsByMessageId.get(record.message_id) ?? [];
    messageCitations.push({
      cvFileId: record.cv_file_id,
      filename: cvFile.original_filename,
      candidateName: cvFile.candidate_name ?? cvFile.original_filename,
      chunkIndex: cvChunk.chunk_index,
      snippet: record.quoted_text ?? "",
      fileUrl,
      score: Number(record.relevance_score ?? 0),
      rerankScore: Number(record.relevance_score ?? 0),
    });
    citationsByMessageId.set(record.message_id, messageCitations);
  }

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      lastMessageAt: conversation.last_message_at,
    },
    messages: (messages ?? []).map((message) => ({
      id: message.id,
      sender: message.role === "assistant" ? "assistant" : "user",
      text: message.content,
      citations: citationsByMessageId.get(message.id) ?? [],
      createdAt: message.created_at,
    })),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const conversation = await ensureConversationExists(conversationId);

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
  };

  if (body.action !== "reset") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  const { error: deleteMessagesError } = await supabaseAdmin
    .from("messages")
    .delete()
    .eq("conversation_id", conversationId);

  if (deleteMessagesError) {
    return NextResponse.json(
      { error: `Failed to reset conversation: ${deleteMessagesError.message}` },
      { status: 500 },
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("conversations")
    .update({
      updated_at: new Date().toISOString(),
      last_message_at: null,
    })
    .eq("id", conversationId);

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to update conversation: ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const conversation = await ensureConversationExists(conversationId);

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 },
    );
  }

  const { error } = await supabaseAdmin
    .from("conversations")
    .update({
      status: "archived",
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  if (error) {
    return NextResponse.json(
      { error: `Failed to delete conversation: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
