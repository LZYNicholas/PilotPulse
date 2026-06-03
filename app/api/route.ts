import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a friendly onboarding assistant for PilotPulse, a recruitment platform.

A job seeker has just uploaded their CV. Your job is to collect three pieces of contact information from them:
1. Full name
2. Phone number
3. Email address

Rules:
- Ask for missing details one at a time in a natural, conversational way.
- If the user provides multiple details in one message, extract all of them.
- Once you have all three, confirm them back clearly in this exact format before saving:

CONFIRM_DETAILS
name: <full name>
phone: <phone number>
email: <email address>

- If the user confirms (replies with yes, correct, looks good, etc.), respond with exactly:

SAVE_DETAILS
name: <full name>
phone: <phone number>
email: <email address>

- If the user corrects something, update the relevant field and show the CONFIRM_DETAILS block again.
- Be concise. Do not ask for anything other than name, phone, and email.
- Do not make up or guess any contact details.`;

type MessageParam = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as {
    messages: MessageParam[];
    cvFileId: string;
  };

  const { messages, cvFileId } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "messages array is required." },
      { status: 400 },
    );
  }

  if (!cvFileId) {
    return NextResponse.json(
      { error: "cvFileId is required." },
      { status: 400 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Anthropic API key is not configured." },
      { status: 500 },
    );
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Anthropic API error:", errorBody);
    return NextResponse.json(
      { error: "Failed to get a response from the AI." },
      { status: 502 },
    );
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const rawText =
    data.content.find((block) => block.type === "text")?.text ?? "";

  // Check if AI is ready to save (user confirmed details)
  if (rawText.startsWith("SAVE_DETAILS")) {
    const extracted = parseContactBlock(rawText);
    return NextResponse.json({
      reply: "Great, saving your details now...",
      action: "save",
      contactDetails: extracted,
    });
  }

  // Check if AI is asking the user to confirm details
  if (rawText.startsWith("CONFIRM_DETAILS")) {
    const extracted = parseContactBlock(rawText);
    const confirmMessage = formatConfirmMessage(extracted);
    return NextResponse.json({
      reply: confirmMessage,
      action: "confirm",
      contactDetails: extracted,
    });
  }

  // Normal conversational reply
  return NextResponse.json({
    reply: rawText,
    action: "chat",
    contactDetails: null,
  });
}

type ContactDetails = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

function parseContactBlock(text: string): ContactDetails {
  const nameMatch = text.match(/^name:\s*(.+)$/im);
  const phoneMatch = text.match(/^phone:\s*(.+)$/im);
  const emailMatch = text.match(/^email:\s*(.+)$/im);

  return {
    name: nameMatch?.[1]?.trim() ?? null,
    phone: phoneMatch?.[1]?.trim() ?? null,
    email: emailMatch?.[1]?.trim() ?? null,
  };
}

function formatConfirmMessage(details: ContactDetails): string {
  return [
    "Just to confirm, here are the details I have:",
    `• Name: ${details.name ?? "—"}`,
    `• Phone: ${details.phone ?? "—"}`,
    `• Email: ${details.email ?? "—"}`,
    "",
    "Does that look correct? Reply yes to save, or let me know what to fix.",
  ].join("\n");
}
