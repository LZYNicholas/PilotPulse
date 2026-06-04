import { NextResponse } from "next/server";

import { searchCvChunks } from "@/lib/cv/search";

export const runtime = "nodejs";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `You are PilotPulse's recruiter assistant.

Answer recruiter questions using only the provided CV context.

Rules:
- Do not invent skills, work history, education, comparisons, or candidate facts.
- If the provided CV context is not enough, say you do not have enough CV evidence.
- When comparing candidates, explain the evidence for each candidate separately.
- Mention candidate names when available; otherwise mention the filename.
- Cite relevant context labels like [1], [2], or [3] in your answer.
- Be concise, recruiter-friendly, and grounded in the CV evidence.`;

type MessageParam = {
  role: "user" | "assistant";
  content: string;
};

function getLatestUserQuestion(messages: MessageParam[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content;
}

function formatContext(
  chunks: Awaited<ReturnType<typeof searchCvChunks>>,
) {
  return chunks
    .map((chunk, index) => {
      const candidateLabel =
        chunk.candidateName?.trim() || chunk.originalFilename || "Unknown candidate";

      return [
        `[${index + 1}]`,
        `Candidate: ${candidateLabel}`,
        `Filename: ${chunk.originalFilename}`,
        chunk.candidateEmail ? `Email: ${chunk.candidateEmail}` : null,
        `Chunk index: ${chunk.chunkIndex}`,
        `CV text: ${chunk.chunkText}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    messages?: MessageParam[];
    question?: string;
  };

  const messages = body.messages ?? [];
  const question = body.question?.trim() || getLatestUserQuestion(messages)?.trim();

  if (!question) {
    return NextResponse.json(
      { error: "A recruiter question is required." },
      { status: 400 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini API key is not configured." },
      { status: 500 },
    );
  }

  let chunks: Awaited<ReturnType<typeof searchCvChunks>>;

  try {
    chunks = await searchCvChunks(question);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to search the CV knowledge base.";

    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (chunks.length === 0) {
    return NextResponse.json({
      reply:
        "I do not have any ready CV chunks to search yet. Upload and process at least one CV before asking recruiter questions.",
      sources: [],
    });
  }

  const userPrompt = [
    "CV CONTEXT:",
    formatContext(chunks),
    "",
    "RECRUITER QUESTION:",
    question,
  ].join("\n");

  const response = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 2048,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Gemini recruiter API error:", errorBody);

    return NextResponse.json(
      { error: "Failed to get a recruiter response from the AI." },
      { status: 502 },
    );
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const reply =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() || "I could not generate a response from the available CV context.";

  return NextResponse.json({
    reply,
    sources: chunks.map((chunk, index) => ({
      label: `[${index + 1}]`,
      cvFileId: chunk.cvFileId,
      chunkId: chunk.chunkId,
      candidateName: chunk.candidateName,
      originalFilename: chunk.originalFilename,
      score: chunk.score,
    })),
  });
}
