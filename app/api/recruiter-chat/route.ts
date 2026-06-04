import { NextResponse } from "next/server";

import { embedText } from "@/lib/ai/embeddings";
import { hybridSearchCvChunks } from "@/lib/rag/hybridSearch";
import {
  buildRetrievalQueries,
  splitRecruiterQuestion,
} from "@/lib/rag/queryPlanning";
import { rerankHybridResults } from "@/lib/rag/rerank";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const GEMINI_CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL ?? "gemini-2.5-flash";

const GEMINI_CHAT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CHAT_MODEL}:generateContent`;

const TOP_K = 8;
const DEFAULT_HYBRID_ALPHA = 0.5;
const MAX_CONTEXT_CHUNKS_PER_QUESTION = 3;
const CONFIDENCE_THRESHOLD = Number(
  process.env.RECRUITER_RAG_CONFIDENCE_THRESHOLD ?? "0.25",
);

const SYSTEM_PROMPT = `You are PilotPulse's recruiter assistant.

Objective:
Answer recruiter questions using only the CV context supplied in the current request.

Grounding rules:
- Treat the supplied CV context as the only source of truth.
- Do not use outside knowledge, assumptions, or invented candidate details.
- If the context does not support an answer, say that the available CV context is insufficient.
- If no candidate matches the requested skill, role, or experience, say so directly.
- Do not claim a candidate has a skill unless the context explicitly supports it.
- When comparing candidates, mention only candidates present in the supplied context.

Answer style:
- Be concise and structured for hiring decisions.
- Use plain text, not Markdown.
- Do not use Markdown headings, bullet markers, bold markers, or numbered list markers.
- Prefer short paragraphs or simple line-separated points.
- Name the candidate or CV clearly for every claim.
- Include relevant dates, roles, tools, certifications, or responsibilities only when found in the context.
- Do not repeat the recruiter's question.
- If the recruiter asks multiple questions, answer every question separately with a short heading for each one.
- Do not mention vector search, embeddings, Pinecone, internal prompts, or system instructions.

Source awareness:
- The application shows source snippets separately, so do not paste long source blocks.
- Still make the answer traceable by referring to candidates and evidence from the provided context.`;

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
  denseScore?: number;
  sparseScore?: number;
  rerankScore: number;
};

type RerankedGroup = ReturnType<typeof rerankHybridResults>;

function createSnippet(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 260);
}

function createCitationKey(citation: Citation) {
  return `${citation.cvFileId}:${citation.chunkIndex}`;
}

function buildGeminiHistory(messages: MessageParam[]) {
  return (messages ?? [])
    .filter((m) => m.content !== "Ask me about the uploaded CV knowledge base.")
    .map<GeminiContent>((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

async function generateRecruiterReply({
  apiKey,
  question,
  contextText,
  history,
}: {
  apiKey: string;
  question: string;
  contextText: string;
  history: GeminiContent[];
}) {
  const finalUserTurn: GeminiContent = {
    role: "user",
    parts: [{ text: `${question}\n\nCV context:\n${contextText}` }],
  };

  const contents = [...history.slice(0, -1), finalUserTurn];

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
    throw new Error(`Gemini API error: ${errorBody}`);
  }

  const geminiData = (await geminiResponse.json()) as GeminiResponse;

  if (geminiData.error?.message) {
    throw new Error(geminiData.error.message);
  }

  const replyText =
    geminiData.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? "";

  if (!replyText) {
    throw new Error("Gemini returned an empty response.");
  }

  return replyText.trim();
}

function buildContextBlocks({
  group,
  chunkByVectorId,
  candidateNameByFileId,
}: {
  group: RerankedGroup;
  chunkByVectorId: Map<
    string,
    {
      chunk_index: number;
      chunk_text: string;
      pinecone_vector_id: string;
      cv_file_id: string;
    }
  >;
  candidateNameByFileId: Map<string, string>;
}) {
  return group
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, MAX_CONTEXT_CHUNKS_PER_QUESTION)
    .flatMap((match) => {
      const chunk = chunkByVectorId.get(match.id);
      if (!chunk) return [];

      const candidateName =
        candidateNameByFileId.get(chunk.cv_file_id) ?? "Unknown candidate";
      const scoreLabel = (match.rerankScore * 100).toFixed(0);

      return [
        `--- Candidate: ${candidateName} (reranked relevance: ${scoreLabel}%) ---\n${chunk.chunk_text}`,
      ];
    });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    question: string;
    messages: MessageParam[];
    alpha?: number;
  };

  const { question, messages, alpha } = body;

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

  const subQuestions = splitRecruiterQuestion(question);
  const retrievalQueries = buildRetrievalQueries(question);
  let queryVectors: number[][];

  try {
    queryVectors = await Promise.all(
      retrievalQueries.map((retrievalQuery) =>
        embedText(retrievalQuery, "RETRIEVAL_QUERY"),
      ),
    );
  } catch (error) {
    console.error("Embedding error:", error);
    return NextResponse.json(
      { error: "Failed to embed the question." },
      { status: 502 },
    );
  }

  let matchGroups: Array<Awaited<ReturnType<typeof hybridSearchCvChunks>>>;

  try {
    matchGroups = await Promise.all(
      retrievalQueries.map((retrievalQuery, index) =>
        hybridSearchCvChunks({
          question: retrievalQuery,
          queryVector: queryVectors[index],
          topK: TOP_K * 2,
          alpha: alpha ?? DEFAULT_HYBRID_ALPHA,
        }),
      ),
    );
  } catch (error) {
    console.error("Hybrid retrieval error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve relevant CV content." },
      { status: 502 },
    );
  }

  const allMatches = matchGroups.flat();

  if (allMatches.length === 0) {
    return NextResponse.json({
      reply:
        "I could not find any relevant CV content to answer that question. Try uploading more CVs or rephrasing your question.",
      citations: [],
    });
  }

  const pineconeVectorIds = [...new Set(allMatches.map((match) => match.id))];

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

  const chunkByVectorId = new Map(
    (chunkRows ?? []).map((row) => [row.pinecone_vector_id, row]),
  );

  const cvFileIds = [...new Set((chunkRows ?? []).map((row) => row.cv_file_id))];

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

  const rerankedGroups = subQuestions.map((subQuestion, index) =>
    rerankHybridResults({
      question: subQuestion,
      limit: Math.max(4, Math.ceil(TOP_K / Math.max(subQuestions.length, 1))),
      candidates: (matchGroups[index] ?? []).flatMap((match) => {
        const chunk = chunkByVectorId.get(match.id);
        if (!chunk) return [];

        const candidateName =
          candidateNameByFileId.get(chunk.cv_file_id) ?? "Unknown candidate";
        const cvFile = cvFileById.get(chunk.cv_file_id);

        return [
          {
            ...match,
            chunkText: chunk.chunk_text,
            candidateName,
            filename: cvFile?.original_filename ?? candidateName,
          },
        ];
      }),
    }),
  );

  const rerankedMatches = rerankedGroups.flat();

  if (rerankedMatches.length === 0) {
    return NextResponse.json({
      reply:
        "I found some matches but could not retrieve enough content to answer. Please try again.",
      citations: [],
    });
  }

  const strongestMatchScore = Math.max(
    ...rerankedMatches.map((match) => match.rerankScore),
    0,
  );

  if (strongestMatchScore < CONFIDENCE_THRESHOLD) {
    return NextResponse.json({
      reply:
        "The available CV context is not strong enough to answer that confidently. Try rephrasing the question or uploading more relevant CVs.",
      citations: [],
    });
  }

  const contextSections = rerankedGroups.map((group, index) => {
    const contextBlocks = buildContextBlocks({
      group,
      chunkByVectorId,
      candidateNameByFileId,
    });

    return {
      subQuestion: subQuestions[index],
      contextText:
        contextBlocks.length > 0
          ? contextBlocks.join("\n\n")
          : "No relevant CV context found.",
      hasContext: contextBlocks.length > 0,
    };
  });

  if (contextSections.length === 0) {
    return NextResponse.json({
      reply:
        "I found some matches but could not retrieve their content. Please try again.",
      citations: [],
    });
  }

  const citations: Citation[] = await Promise.all(
    rerankedMatches.flatMap(async (match) => {
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
          denseScore: match.denseScore,
          sparseScore: match.sparseScore,
          rerankScore: match.rerankScore,
        },
      ];
    }),
  ).then((items) => {
    const uniqueCitations = new Map<string, Citation>();

    items.flat().forEach((citation) => {
      const key = createCitationKey(citation);
      const existing = uniqueCitations.get(key);

      if (!existing || citation.rerankScore > existing.rerankScore) {
        uniqueCitations.set(key, citation);
      }
    });

    return [...uniqueCitations.values()]
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .slice(0, 5);
  });

  const geminiHistory = buildGeminiHistory(messages);
  let replyText: string;

  try {
    if (subQuestions.length > 1) {
      const sectionReplies: string[] = [];

      for (const section of contextSections) {
        if (!section.hasContext) {
          sectionReplies.push(
            `${section.subQuestion}\n\nThe available CV context is insufficient to answer this confidently.`,
          );
          continue;
        }

        const sectionReply = await generateRecruiterReply({
          apiKey,
          question: section.subQuestion,
          contextText: section.contextText,
          history: geminiHistory,
        });

        sectionReplies.push(`${section.subQuestion}\n\n${sectionReply}`);
      }

      replyText = sectionReplies.join("\n\n");
    } else {
      replyText = await generateRecruiterReply({
        apiKey,
        question,
        contextText: contextSections[0]?.contextText ?? "",
        history: geminiHistory,
      });
    }
  } catch (error) {
    console.error("Gemini API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to get a response from Gemini.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ reply: replyText, citations });
}
