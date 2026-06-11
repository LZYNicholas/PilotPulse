import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { embedText } from "@/lib/ai/embeddings";
import { fetchWithRetry } from "@/lib/ai/fetchWithRetry";
import { hybridSearchCvChunks } from "@/lib/rag/hybridSearch";
import {
  buildRetrievalQueries,
  formatRecruiterQuestionLabel,
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
const MAX_CONTEXT_CHUNKS_PER_QUESTION = 2;
const MAX_CANDIDATES_PER_QUESTION = 3;
const MAX_CHUNKS_PER_CANDIDATE = 2;
const ANSWER_CACHE_TTL_MS = 5 * 60 * 1000;
const SECTION_CONFIDENCE_THRESHOLD = Number(
  process.env.RECRUITER_RAG_SECTION_CONFIDENCE_THRESHOLD ?? "1.5",
);
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
- Start with a direct answer.
- Use brief evidence statements instead of long explanations.
- Name the candidate clearly for every claim.
- Include relevant dates, roles, tools, certifications, or responsibilities only when found in the context.
- Do not repeat the recruiter's question in full.
- If the recruiter asks multiple questions, answer each one separately.
- Return at most 3 candidates unless the user explicitly asks for more.
- For each candidate, keep the answer to 2 or 3 short lines maximum.
- Focus on the strongest matches first, not every possible match.
- Avoid repeating the same candidate or the same evidence in different wording.
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
  chunkId?: string;
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

type ChunkRow = {
  id: string;
  chunk_index: number;
  chunk_text: string;
  pinecone_vector_id: string;
  cv_file_id: string;
};

type CvFileRow = {
  id: string;
  candidate_name: string | null;
  original_filename: string;
  storage_path: string;
};

type RerankedGroup = ReturnType<typeof rerankHybridResults>;

type CachedAnswer = {
  expiresAt: number;
  reply: string;
};

type ContextSection = {
  subQuestion: string;
  displayQuestion: string;
  contextText: string;
  hasContext: boolean;
  extraCandidateCount: number;
};

const recruiterAnswerCache = new Map<string, CachedAnswer>();

function formatHeader(text: string) {
  return `[[header]]${text}[[/header]]`;
}

function createSnippet(text: string) {
  return text
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function normalizeFilename(filename: string) {
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\s*\(\d+\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizeCandidateIdentity(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        token.length > 2 &&
        !["cv", "raw", "officer", "engineer", "cost", "control", "pdf"].includes(
          token,
        ),
    );
}

function createCandidateKey({
  candidateName,
  filename,
}: {
  candidateName: string;
  filename: string;
}) {
  const trimmedCandidateName = candidateName.trim();
  const fallbackName = normalizeFilename(filename);
  const filenameTokens = tokenizeCandidateIdentity(fallbackName);

  if (
    !trimmedCandidateName ||
    trimmedCandidateName.toLowerCase() === filename.toLowerCase()
  ) {
    return filenameTokens.slice(0, 2).join(" ") || fallbackName;
  }

  const candidateTokens = tokenizeCandidateIdentity(trimmedCandidateName);
  const overlapTokens = candidateTokens.filter((token) =>
    filenameTokens.includes(token),
  );

  if (overlapTokens.length > 0) {
    return overlapTokens.slice(0, 2).join(" ");
  }

  return candidateTokens.slice(0, 2).join(" ") || trimmedCandidateName.toLowerCase();
}

function scoreDisplayName(displayName: string, filename: string) {
  const trimmed = displayName.trim();
  if (!trimmed) return 0;

  let score = trimmed.length;
  if (trimmed.toLowerCase() !== filename.trim().toLowerCase()) {
    score += 20;
  }

  if (/^[a-z ,.'-]+$/i.test(trimmed)) {
    score += 10;
  }

  if (!/\b(cv|resume|pdf|raw)\b/i.test(trimmed)) {
    score += 10;
  }

  return score;
}

function getCandidateIdentity({
  candidateName,
  filename,
}: {
  candidateName: string;
  filename: string;
}) {
  return {
    key: createCandidateKey({ candidateName, filename }),
    displayName:
      scoreDisplayName(candidateName, filename) >=
      scoreDisplayName(filename, filename)
        ? candidateName.trim()
        : filename.trim(),
  };
}

function createCitationKey(citation: Citation) {
  return `${normalizeFilename(citation.filename)}:${citation.chunkIndex}`;
}

function normalizeRecruiterReply(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildConversationTitle(question: string) {
  const normalized = question.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 80) || "New conversation";
}

async function persistConversationTurn({
  conversation,
  question,
  replyText,
  citations,
  modelName,
}: {
  conversation:
    | {
        id: string;
        title: string;
      }
    | null;
  question: string;
  replyText: string;
  citations: Citation[];
  modelName: string;
}) {
  if (!conversation) return;

  const { count: existingMessageCount } = await supabaseAdmin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id);

  const { data: userMessageRow, error: userMessageError } = await supabaseAdmin
    .from("messages")
    .insert({
      id: randomUUID(),
      conversation_id: conversation.id,
      role: "user",
      content: question,
    })
    .select("id")
    .single();

  if (userMessageError || !userMessageRow) {
    console.error("Failed to save user message:", userMessageError);
  } else {
    const { data: assistantMessageRow, error: assistantMessageError } =
      await supabaseAdmin
        .from("messages")
        .insert({
          id: randomUUID(),
          conversation_id: conversation.id,
          role: "assistant",
          content: normalizeRecruiterReply(replyText),
          model_name: modelName,
        })
        .select("id")
        .single();

    if (assistantMessageError || !assistantMessageRow) {
      console.error("Failed to save assistant message:", assistantMessageError);
    } else if (citations.length > 0) {
      const citationRows = citations
        .filter((citation) => citation.chunkId)
        .map((citation, index) => ({
          id: randomUUID(),
          message_id: assistantMessageRow.id,
          cv_file_id: citation.cvFileId,
          cv_chunk_id: citation.chunkId!,
          citation_index: index,
          quoted_text: citation.snippet,
          relevance_score: citation.rerankScore,
        }));

      if (citationRows.length > 0) {
        const { error: citationInsertError } = await supabaseAdmin
          .from("conversation_message_citations")
          .insert(citationRows);

        if (citationInsertError) {
          console.error("Failed to save message citations:", citationInsertError);
        }
      }
    }
  }

  const conversationTitle =
    conversation.title === "New conversation" && (existingMessageCount ?? 0) === 0
      ? buildConversationTitle(question)
      : conversation.title;

  const { error: conversationUpdateError } = await supabaseAdmin
    .from("conversations")
    .update({
      title: conversationTitle,
      updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);

  if (conversationUpdateError) {
    console.error("Failed to update conversation timestamps:", conversationUpdateError);
  }
}

function buildAnswerCacheKey(question: string, contextText: string) {
  return `${question}::${contextText}`;
}

function getCachedAnswer(cacheKey: string) {
  const cached = recruiterAnswerCache.get(cacheKey);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    recruiterAnswerCache.delete(cacheKey);
    return null;
  }

  return cached.reply;
}

function setCachedAnswer(cacheKey: string, reply: string) {
  recruiterAnswerCache.set(cacheKey, {
    reply,
    expiresAt: Date.now() + ANSWER_CACHE_TTL_MS,
  });
}

function buildGeminiHistory(messages: MessageParam[]) {
  return (messages ?? [])
    .filter((m) => m.content !== "Ask me about the uploaded CV knowledge base.")
    .map<GeminiContent>((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

function buildRecruiterUserPrompt(question: string, contextText: string) {
  return [
    "Answer the recruiter using only the CV context below.",
    "Show only the top matches.",
    `Limit the answer to at most ${MAX_CANDIDATES_PER_QUESTION} candidates.`,
    "For each candidate, use 2 or 3 short lines of evidence maximum.",
    "If the context is weak or insufficient, say that clearly.",
    "",
    `Question: ${question}`,
    "",
    "CV context:",
    contextText,
  ].join("\n");
}

function countUniqueCandidates({
  group,
  chunkByVectorId,
  cvFileById,
}: {
  group: RerankedGroup;
  chunkByVectorId: Map<string, ChunkRow>;
  cvFileById: Map<string, CvFileRow>;
}) {
  const candidateKeys = new Set<string>();

  group.forEach((match) => {
    const chunk = chunkByVectorId.get(match.id);
    if (!chunk) return;

    const cvFile = cvFileById.get(chunk.cv_file_id);
    if (!cvFile) return;

    const candidateName = cvFile.candidate_name ?? cvFile.original_filename;
    const candidateIdentity = getCandidateIdentity({
      candidateName,
      filename: cvFile.original_filename,
    });

    candidateKeys.add(candidateIdentity.key);
  });

  return candidateKeys.size;
}

function dedupeRerankedGroup({
  group,
  chunkByVectorId,
  cvFileById,
}: {
  group: RerankedGroup;
  chunkByVectorId: Map<string, ChunkRow>;
  cvFileById: Map<string, CvFileRow>;
}) {
  const sorted = [...group].sort((a, b) => b.rerankScore - a.rerankScore);
  const chunkCountsByCandidate = new Map<string, number>();
  const candidateFirstSeenOrder: string[] = [];
  const deduped: RerankedGroup = [];

  for (const match of sorted) {
    const chunk = chunkByVectorId.get(match.id);
    if (!chunk) continue;

    const cvFile = cvFileById.get(chunk.cv_file_id);
    if (!cvFile) continue;

    const candidateName = cvFile.candidate_name ?? cvFile.original_filename;
    const candidateIdentity = getCandidateIdentity({
      candidateName,
      filename: cvFile.original_filename,
    });
    const candidateKey = candidateIdentity.key;

    if (!candidateFirstSeenOrder.includes(candidateKey)) {
      if (candidateFirstSeenOrder.length >= MAX_CANDIDATES_PER_QUESTION) {
        continue;
      }

      candidateFirstSeenOrder.push(candidateKey);
    }

    const chunkCount = chunkCountsByCandidate.get(candidateKey) ?? 0;
    if (chunkCount >= MAX_CHUNKS_PER_CANDIDATE) continue;

    chunkCountsByCandidate.set(candidateKey, chunkCount + 1);
    deduped.push(match);
  }

  return deduped;
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
  const cacheKey = buildAnswerCacheKey(question, contextText);
  const cachedAnswer = getCachedAnswer(cacheKey);

  if (cachedAnswer) {
    return cachedAnswer;
  }

  const finalUserTurn: GeminiContent = {
    role: "user",
    parts: [{ text: buildRecruiterUserPrompt(question, contextText) }],
  };

  const contents = [...history.slice(0, -1), finalUserTurn];

  const geminiResponse = await fetchWithRetry(
    `${GEMINI_CHAT_URL}?key=${apiKey}`,
    {
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
    },
  );

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

  const normalizedReply = normalizeRecruiterReply(replyText);
  setCachedAnswer(cacheKey, normalizedReply);
  return normalizedReply;
}

function buildContextBlocks({
  group,
  chunkByVectorId,
  candidateNameByFileId,
}: {
  group: RerankedGroup;
  chunkByVectorId: Map<string, ChunkRow>;
  candidateNameByFileId: Map<string, string>;
}) {
  return group.slice(0, MAX_CONTEXT_CHUNKS_PER_QUESTION).flatMap((match) => {
    const chunk = chunkByVectorId.get(match.id);
    if (!chunk) return [];

    const candidateName =
      candidateNameByFileId.get(chunk.cv_file_id) ?? "Unknown candidate";
    const scoreLabel = (match.rerankScore * 100).toFixed(0);

    return [
      `Candidate: ${candidateName} (relevance ${scoreLabel}%)\n${chunk.chunk_text}`,
    ];
  });
}

function buildDeterministicSectionReply({
  question,
  group,
  chunkByVectorId,
  candidateNameByFileId,
  extraCandidateCount,
}: {
  question: string;
  group: RerankedGroup;
  chunkByVectorId: Map<string, ChunkRow>;
  candidateNameByFileId: Map<string, string>;
  extraCandidateCount?: number;
}) {
  if (group.length === 0) {
    return `${question}\n\nThe available CV context is insufficient to answer this confidently.`;
  }

  const candidateEvidence = new Map<
    string,
    { bestScore: number; displayName: string; snippets: string[] }
  >();

  group.forEach((match) => {
    const chunk = chunkByVectorId.get(match.id);
    if (!chunk) return;

    const rawCandidateName =
      candidateNameByFileId.get(chunk.cv_file_id) ?? "Unknown candidate";
    const filename = match.filename ?? rawCandidateName;
    const candidateIdentity = getCandidateIdentity({
      candidateName: rawCandidateName,
      filename,
    });
    const snippet = createSnippet(chunk.chunk_text);
    const current = candidateEvidence.get(candidateIdentity.key) ?? {
      bestScore: 0,
      displayName: candidateIdentity.displayName,
      snippets: [],
    };

    current.bestScore = Math.max(current.bestScore, match.rerankScore);
    if (
      scoreDisplayName(candidateIdentity.displayName, filename) >
      scoreDisplayName(current.displayName, filename)
    ) {
      current.displayName = candidateIdentity.displayName;
    }

    if (
      snippet &&
      current.snippets.length < 2 &&
      !current.snippets.includes(snippet)
    ) {
      current.snippets.push(snippet);
    }

    candidateEvidence.set(candidateIdentity.key, current);
  });

  const sections = [...candidateEvidence.entries()]
    .sort((a, b) => b[1].bestScore - a[1].bestScore)
    .slice(0, MAX_CANDIDATES_PER_QUESTION)
    .map(([, evidence]) => {
      const body = evidence.snippets
        .slice(0, 2)
        .map((snippet) => `Evidence: ${snippet.replace(/\.\s*$/, "")}`)
        .join("\n");

      return `${evidence.displayName}\n${body}`;
    });

  if (sections.length === 0) {
    return `${question}\n\nThe available CV context is insufficient to answer this confidently.`;
  }

  const overflowNote =
    (extraCandidateCount ?? 0) > 0
      ? `\n\nOther possible matches may exist in the uploaded CVs. Ask for more results if you want a broader list.`
      : "";

  return `${question}\n\nLikely matches based on the uploaded CV context:\n\n${sections.join("\n\n")}${overflowNote}`;
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    question: string;
    messages: MessageParam[];
    alpha?: number;
    conversationId?: string;
  };

  const { question, messages, alpha, conversationId } = body;

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

  let conversation:
    | {
        id: string;
        title: string;
      }
    | null = null;

  if (conversationId) {
    const { data: existingConversation, error: conversationError } =
      await supabaseAdmin
        .from("conversations")
        .select("id, title")
        .eq("id", conversationId)
        .is("deleted_at", null)
        .single();

    if (conversationError || !existingConversation) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404 },
      );
    }

    conversation = existingConversation;
  }

  const subQuestions = splitRecruiterQuestion(question);
  const displayQuestions = subQuestions.map(formatRecruiterQuestionLabel);
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
    const reply =
      "I could not find any relevant CV content to answer that question. Try uploading more CVs or rephrasing your question.";
    await persistConversationTurn({
      conversation,
      question,
      replyText: reply,
      citations: [],
      modelName: "recruiter-fallback",
    });
    return NextResponse.json({
      reply,
      citations: [],
      conversationId: conversation?.id ?? null,
    });
  }

  const pineconeVectorIds = [...new Set(allMatches.map((match) => match.id))];

  const { data: chunkRows, error: chunkError } = await supabaseAdmin
    .from("cv_chunks")
    .select("id, chunk_index, chunk_text, pinecone_vector_id, cv_file_id")
    .in("pinecone_vector_id", pineconeVectorIds);

  if (chunkError) {
    console.error("Supabase chunk fetch error:", chunkError);
    return NextResponse.json(
      { error: "Failed to fetch CV chunk content." },
      { status: 500 },
    );
  }

  const chunkByVectorId = new Map(
    ((chunkRows ?? []) as ChunkRow[]).map((row) => [row.pinecone_vector_id, row]),
  );

  const cvFileIds = [...new Set((chunkRows ?? []).map((row) => row.cv_file_id))];

  const { data: cvFileRows } = await supabaseAdmin
    .from("cv_files")
    .select("id, candidate_name, original_filename, storage_path")
    .in("id", cvFileIds);

  const typedCvFileRows = (cvFileRows ?? []) as CvFileRow[];
  const candidateNameByFileId = new Map(
    typedCvFileRows.map((row) => [
      row.id,
      row.candidate_name ?? row.original_filename,
    ]),
  );
  const cvFileById = new Map(typedCvFileRows.map((row) => [row.id, row]));

  const rerankedGroups = subQuestions.map((subQuestion, index) => {
    const group = rerankHybridResults({
      question: subQuestion,
      limit: TOP_K,
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
    });

    const uniqueCandidateCount = countUniqueCandidates({
      group,
      chunkByVectorId,
      cvFileById,
    });

    const dedupedGroup = dedupeRerankedGroup({
      group,
      chunkByVectorId,
      cvFileById,
    });

    return {
      group: dedupedGroup,
      extraCandidateCount: Math.max(
        0,
        uniqueCandidateCount - MAX_CANDIDATES_PER_QUESTION,
      ),
    };
  });

  const rerankedMatches = rerankedGroups.flatMap((entry) => entry.group);

  if (rerankedMatches.length === 0) {
    const reply =
      "I found some matches but could not retrieve enough content to answer. Please try again.";
    await persistConversationTurn({
      conversation,
      question,
      replyText: reply,
      citations: [],
      modelName: "recruiter-fallback",
    });
    return NextResponse.json({
      reply,
      citations: [],
      conversationId: conversation?.id ?? null,
    });
  }

  const strongestMatchScore = Math.max(
    ...rerankedMatches.map((match) => match.rerankScore),
    0,
  );

  if (strongestMatchScore < CONFIDENCE_THRESHOLD) {
    const reply =
      "The available CV context is not strong enough to answer that confidently. Try rephrasing the question or uploading more relevant CVs.";
    await persistConversationTurn({
      conversation,
      question,
      replyText: reply,
      citations: [],
      modelName: "recruiter-fallback",
    });
    return NextResponse.json({
      reply,
      citations: [],
      conversationId: conversation?.id ?? null,
    });
  }

  const contextSections = rerankedGroups.map<ContextSection>((entry, index) => {
    const group = entry.group;
    const contextBlocks = buildContextBlocks({
      group,
      chunkByVectorId,
      candidateNameByFileId,
    });
    const sectionStrongestScore = Math.max(
      ...group.map((match) => match.rerankScore),
      0,
    );

    return {
      subQuestion: subQuestions[index],
      displayQuestion: displayQuestions[index],
      contextText:
        contextBlocks.length > 0
          ? contextBlocks.join("\n\n")
          : "No relevant CV context found.",
      hasContext:
        contextBlocks.length > 0 &&
        sectionStrongestScore >= SECTION_CONFIDENCE_THRESHOLD,
      extraCandidateCount: entry.extraCandidateCount,
    };
  });

  if (contextSections.length === 0) {
    const reply =
      "I found some matches but could not retrieve their content. Please try again.";
    await persistConversationTurn({
      conversation,
      question,
      replyText: reply,
      citations: [],
      modelName: "recruiter-fallback",
    });
    return NextResponse.json({
      reply,
      citations: [],
      conversationId: conversation?.id ?? null,
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
          chunkId: chunk.id,
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
  let usedFallback = false;

  if (subQuestions.length > 1) {
    const sectionReplies: string[] = [];

    for (const [index, section] of contextSections.entries()) {
      if (!section.hasContext) {
        sectionReplies.push(
          `${formatHeader(section.displayQuestion)}\n\nThe available CV context is insufficient to answer this confidently.`,
        );
        continue;
      }

      try {
        const sectionReply = await generateRecruiterReply({
          apiKey,
          question: section.subQuestion,
          contextText: section.contextText,
          history: geminiHistory,
        });

        const replyWithOverflowNote =
          section.extraCandidateCount > 0
            ? `${sectionReply}\n\nOther possible matches may exist in the uploaded CVs. Ask for more results if you want a broader list.`
            : sectionReply;

        sectionReplies.push(
          `${formatHeader(section.displayQuestion)}\n\n${replyWithOverflowNote}`,
        );
      } catch (error) {
        console.error("Gemini section error:", error);
        usedFallback = true;
        sectionReplies.push(
          `${formatHeader(section.displayQuestion)}\n\n${buildDeterministicSectionReply({
            question: section.displayQuestion,
            group: rerankedGroups[index]?.group ?? [],
            chunkByVectorId,
            candidateNameByFileId,
            extraCandidateCount: section.extraCandidateCount,
          }).replace(`${section.displayQuestion}\n\n`, "")}`,
        );
      }
    }

    replyText = sectionReplies.join("\n\n");
  } else {
    try {
      replyText = await generateRecruiterReply({
        apiKey,
        question,
        contextText: contextSections[0]?.contextText ?? "",
        history: geminiHistory,
      });

      if ((contextSections[0]?.extraCandidateCount ?? 0) > 0) {
        replyText = `${replyText}\n\nOther possible matches may exist in the uploaded CVs. Ask for more results if you want a broader list.`;
      }
    } catch (error) {
      console.error("Gemini API error:", error);
      usedFallback = true;
      replyText = buildDeterministicSectionReply({
        question: displayQuestions[0] ?? question,
        group: rerankedGroups[0]?.group ?? [],
        chunkByVectorId,
        candidateNameByFileId,
        extraCandidateCount: contextSections[0]?.extraCandidateCount ?? 0,
      });
    }
  }

  await persistConversationTurn({
    conversation,
    question,
    replyText,
    citations,
    modelName: usedFallback ? "recruiter-fallback" : GEMINI_CHAT_MODEL,
  });

  return NextResponse.json({
    reply: normalizeRecruiterReply(replyText),
    citations,
    mode: usedFallback ? "fallback" : "gemini",
    conversationId: conversation?.id ?? null,
  });
}
