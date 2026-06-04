import { NextResponse } from "next/server";

import { embedText } from "@/lib/ai/embeddings";
import { queryPinecone } from "@/lib/pinecone/query";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const GEMINI_CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL ?? "gemini-2.5-flash";

const GEMINI_CHAT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent`;

// How many Pinecone matches to retrieve before fetching chunk text.
const TOP_K = 8;

// System prompt that instructs Gemini to answer strictly from CV context.
const SYSTEM_PROMPT = `You are a recruitment assistant for PilotPulse with access to a knowledge base of candidate CVs.

Answer the recruiter's question using only the CV context provided below. Each context block is labelled with the candidate's name and a relevance score.

Rules:
- Base every claim on the provided context. Do not invent or assume details.
- When comparing candidates, address each one specifically by name.
- If the context does not contain enough information to answer, say so clearly.
- Keep answers concise, structured, and useful for a hiring decision.
- Do not repeat the question back to the recruiter.`;

type MessageParam = {
  role: "user" | "assistant";
  content: string;
};

type GeminiContent = {
  role: "user" | "model";
  parts: Array<{ text: string }>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type Citation = {
  cvFileId: string;
  filename: string;
  candidateName: string;
  chunkIndex: number;
  snippet: string;
  fileUrl: string | null;
  score: number;
};

function createSnippet(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 260);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    question: string;
    messages: MessageParam[];
  };

  const { question, messages } = body;

  if (!question?.trim()) {
    return NextResponse.json(
      { error: "question is required." },
      { status: 400 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  // ── Step 1: Embed the recruiter's question ──────────────────────────────
  let queryVector: number[];

  try {
    queryVector = await embedText(question, "RETRIEVAL_QUERY");
  } catch (error) {
    console.error("Embedding error:", error);
    return NextResponse.json(
      { error: "Failed to embed the question." },
      { status: 502 },
    );
  }

  // ── Step 2: Query Pinecone for the most relevant chunk vectors ──────────
  let matches: Awaited<ReturnType<typeof queryPinecone>>;

  try {
    matches = await queryPinecone(queryVector, TOP_K);
  } catch (error) {
    console.error("Pinecone query error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve relevant CV content." },
      { status: 502 },
    );
  }

  if (matches.length === 0) {
    return NextResponse.json({
      reply:
        "I could not find any relevant CV content to answer that question. Try uploading more CVs or rephrasing your question.",
      citations: [],
    });
  }

  // ── Step 3: Fetch matching chunk text from Supabase ─────────────────────
  // Pinecone returns pinecone_vector_id as the match id.
  // cv_chunks stores pinecone_vector_id so we can look up the full chunk text.
  const pineconeVectorIds = matches.map((match) => match.id);

  const { data: chunkRows, error: chunkError } = await supabaseAdmin
    .from("cv_chunks")
    .select("chunk_index, chunk_text, pinecone_vector_id, cv_file_id")
    .in("pinecone_vector_id", pineconeVectorIds);

  if (chunkError) {
    console.error("Supabase chunk fetch error:", chunkError);
    return NextResponse.json(
      { error: "Failed to fetch CV chunk content." },
      { status: 500 },
    );
  }

  // Build a lookup so we can sort chunk rows by Pinecone relevance score.
  const chunkByVectorId = new Map(
    (chunkRows ?? []).map((row) => [row.pinecone_vector_id, row]),
  );

  // Fetch candidate names for the cv_file_ids we found.
  const cvFileIds = [
    ...new Set((chunkRows ?? []).map((row) => row.cv_file_id)),
  ];

  const { data: cvFileRows } = await supabaseAdmin
    .from("cv_files")
    .select("id, candidate_name, original_filename, storage_path")
    .in("id", cvFileIds);

  const candidateNameByFileId = new Map(
    (cvFileRows ?? []).map((row) => [
      row.id,
      row.candidate_name ?? row.original_filename,
    ]),
  );
  const cvFileById = new Map((cvFileRows ?? []).map((row) => [row.id, row]));

  // ── Step 4: Build the context string for Gemini ─────────────────────────
  // Sort matches by score descending and build labelled context blocks.
  const contextBlocks = matches
    .sort((a, b) => b.score - a.score)
    .flatMap((match) => {
      const chunk = chunkByVectorId.get(match.id);
      if (!chunk) return [];

      const candidateName =
        candidateNameByFileId.get(chunk.cv_file_id) ?? "Unknown candidate";
      const scoreLabel = (match.score * 100).toFixed(0);

      return [
        `--- Candidate: ${candidateName} (relevance: ${scoreLabel}%) ---\n${chunk.chunk_text}`,
      ];
    });

  if (contextBlocks.length === 0) {
    return NextResponse.json({
      reply:
        "I found some matches but could not retrieve their content. Please try again.",
      citations: [],
    });
  }

  const citations: Citation[] = await Promise.all(
    matches.flatMap(async (match) => {
      const chunk = chunkByVectorId.get(match.id);
      if (!chunk) return [];

      const cvFile = cvFileById.get(chunk.cv_file_id);
      if (!cvFile) return [];

      const { data: signedUrlData } = await supabaseAdmin.storage
        .from("cv-uploads")
        .createSignedUrl(cvFile.storage_path, 60 * 60);

      return [
        {
          cvFileId: chunk.cv_file_id,
          filename: cvFile.original_filename,
          candidateName: cvFile.candidate_name ?? cvFile.original_filename,
          chunkIndex: chunk.chunk_index,
          snippet: createSnippet(chunk.chunk_text),
          fileUrl: signedUrlData?.signedUrl ?? null,
          score: match.score,
        },
      ];
    }),
  ).then((items) => items.flat().slice(0, 5));

  const contextText = contextBlocks.join("\n\n");

  // ── Step 5: Build Gemini conversation history ───────────────────────────
  // Gemini uses "model" instead of "assistant" for the AI role.
  // Filter out the static welcome message before sending history.
  const geminiHistory: GeminiContent[] = (messages ?? [])
    .filter((m) => m.content !== "Ask me about the uploaded CV knowledge base.")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  // The final user turn includes the question plus the retrieved context.
  const finalUserTurn: GeminiContent = {
    role: "user",
    parts: [
      {
        text: `${question}\n\nCV context:\n${contextText}`,
      },
    ],
  };

  // Replace the last user turn in history with the context-augmented version.
  // (Felisha's page sends the full history including the current question,
  // so we drop the last entry and replace it with the enriched turn.)
  const historyWithoutLastTurn = geminiHistory.slice(0, -1);
  const contents = [...historyWithoutLastTurn, finalUserTurn];

  // ── Step 6: Call Gemini ─────────────────────────────────────────────────
  const geminiResponse = await fetch(`${GEMINI_CHAT_URL}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.2,
      },
    }),
  });

  if (!geminiResponse.ok) {
    const errorBody = await geminiResponse.text();
    console.error("Gemini API error:", errorBody);
    return NextResponse.json(
      { error: "Failed to get a response from Gemini." },
      { status: 502 },
    );
  }

  const geminiData = (await geminiResponse.json()) as GeminiResponse;

  if (geminiData.error?.message) {
    console.error("Gemini error in response body:", geminiData.error.message);
    return NextResponse.json(
      { error: geminiData.error.message },
      { status: 502 },
    );
  }

  const replyText =
    geminiData.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? "";

  if (!replyText) {
    return NextResponse.json(
      { error: "Gemini returned an empty response." },
      { status: 502 },
    );
  }

  return NextResponse.json({ reply: replyText, citations });
}

