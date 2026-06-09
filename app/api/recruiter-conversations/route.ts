import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildConversationTitle(title?: string | null) {
  const trimmed = title?.trim();
  if (!trimmed) return "New conversation";
  return trimmed.slice(0, 80);
}

export async function GET() {
  const { data: conversations, error } = await supabaseAdmin
    .from("conversations")
    .select("id, title, created_at, updated_at, last_message_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: `Failed to load conversations: ${error.message}` },
      { status: 500 },
    );
  }

  const conversationIds = (conversations ?? []).map((conversation) => conversation.id);

  const { data: messages, error: messagesError } =
    conversationIds.length > 0
      ? await supabaseAdmin
          .from("messages")
          .select("conversation_id, content, created_at")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };

  if (messagesError) {
    return NextResponse.json(
      { error: `Failed to load conversation previews: ${messagesError.message}` },
      { status: 500 },
    );
  }

  const previewByConversationId = new Map<
    string,
    { content: string; createdAt: string }
  >();

  for (const message of messages ?? []) {
    if (!previewByConversationId.has(message.conversation_id)) {
      previewByConversationId.set(message.conversation_id, {
        content: message.content,
        createdAt: message.created_at,
      });
    }
  }

  return NextResponse.json({
    conversations: (conversations ?? []).map((conversation) => {
      const preview = previewByConversationId.get(conversation.id);

      return {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
        lastMessageAt: conversation.last_message_at,
        lastMessagePreview: preview?.content ?? "",
        isEmpty: !preview,
      };
    }),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    title?: string | null;
  };

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .insert({
      id: randomUUID(),
      title: buildConversationTitle(body.title),
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .select("id, title, created_at, updated_at, last_message_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: `Failed to create conversation: ${error?.message ?? "Unknown error."}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    conversation: {
      id: data.id,
      title: data.title,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      lastMessageAt: data.last_message_at,
      lastMessagePreview: "",
      isEmpty: true,
    },
  });
}
