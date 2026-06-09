"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Sender = "assistant" | "user";

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
  rerankScore?: number;
};

type ChatMessage = {
  id: string;
  sender: Sender;
  text: string;
  citations?: Citation[];
  createdAt?: string;
};

type RecruiterFile = {
  id: string;
  originalFilename: string;
  fileSizeBytes: number;
  uploadStatus: string;
  uploadedAt: string;
  candidateName: string | null;
  candidateEmail: string | null;
  fileUrl: string | null;
};

type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  isEmpty: boolean;
};

const initialMessages: ChatMessage[] = [
  {
    id: "recruiter-welcome",
    sender: "assistant",
    text: "Ask me about the uploaded CV knowledge base.",
  },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null) {
  if (!value) return "";

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function makeMessage(
  sender: Sender,
  text: string,
  citations?: Citation[],
): ChatMessage {
  return {
    id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sender,
    text,
    citations,
  };
}

function formatScore(score?: number) {
  if (score === undefined) return "n/a";
  return `${Math.round(score * 100)}%`;
}

function getResumeLinks(citations: Citation[]) {
  const uniqueResumes = new Map<
    string,
    { label: string; fileUrl: string | null; rerankScore: number }
  >();

  citations.forEach((citation) => {
    const key = citation.cvFileId;
    const label = citation.candidateName || citation.filename;
    const existing = uniqueResumes.get(key);

    if (!existing || (citation.rerankScore ?? 0) > existing.rerankScore) {
      uniqueResumes.set(key, {
        label,
        fileUrl: citation.fileUrl,
        rerankScore: citation.rerankScore ?? 0,
      });
    }
  });

  return [...uniqueResumes.entries()]
    .sort((a, b) => b[1].rerankScore - a[1].rerankScore)
    .map(([cvFileId, value]) => ({
      cvFileId,
      label: value.label,
      fileUrl: value.fileUrl,
    }));
}

function renderMessageText(text: string) {
  const lines = text.split("\n");

  return lines.map((line, index) => {
    const headerMatch = line.match(/^\[\[header\]\](.*?)\[\[\/header\]\]$/);

    if (headerMatch) {
      return (
        <strong
          key={`line-${index}`}
          className="block font-semibold text-zinc-50"
        >
          {headerMatch[1]}
        </strong>
      );
    }

    return (
      <span key={`line-${index}`} className="block">
        {line || "\u00A0"}
      </span>
    );
  });
}

function normalizePreview(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export default function RecruiterChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<RecruiterFile[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const [activeConversationTitle, setActiveConversationTitle] = useState(
    "New conversation",
  );
  const [activeCitationMessageId, setActiveCitationMessageId] = useState<
    string | null
  >(null);
  const [isSourcesPanelOpen, setIsSourcesPanelOpen] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<
    string | null
  >(null);
  const [openFileMenuId, setOpenFileMenuId] = useState<string | null>(null);
  const skipNextConversationLoadRef = useRef<string | null>(null);

  const visibleFiles = showAllFiles ? files : files.slice(0, 8);
  const activeCitationMessage = messages.find(
    (message) => message.id === activeCitationMessageId,
  );
  const activeCitations = activeCitationMessage?.citations ?? [];

  const activeConversationSummary = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === activeConversationId) ??
      null,
    [activeConversationId, conversations],
  );

  async function loadFiles() {
    setIsLoadingFiles(true);
    setListError(null);

    try {
      const response = await fetch("/api/uploads", { cache: "no-store" });
      const payload = (await response.json()) as
        | { files?: RecruiterFile[]; error?: string }
        | undefined;

      if (!response.ok || !payload?.files) {
        setListError(payload?.error ?? "Could not load CVs.");
        return;
      }

      setFiles(payload.files);
    } catch {
      setListError("Could not load CVs.");
    } finally {
      setIsLoadingFiles(false);
    }
  }

  async function loadConversations(preferredConversationId?: string | null) {
    setIsLoadingConversations(true);
    setConversationError(null);

    try {
      const response = await fetch("/api/recruiter-conversations", {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | { conversations?: ConversationSummary[]; error?: string }
        | undefined;

      if (!response.ok || !payload?.conversations) {
        setConversationError(payload?.error ?? "Could not load conversations.");
        return [];
      }

      setConversations(payload.conversations);

      const nextConversationId =
        preferredConversationId ??
        (typeof window !== "undefined"
          ? window.localStorage.getItem("recruiterActiveConversationId")
          : null);

      if (
        nextConversationId &&
        payload.conversations.some(
          (conversation) => conversation.id === nextConversationId,
        )
      ) {
        setActiveConversationId(nextConversationId);
        return payload.conversations;
      }

      if (
        activeConversationId &&
        payload.conversations.some(
          (conversation) => conversation.id === activeConversationId,
        )
      ) {
        return payload.conversations;
      }

      const firstConversation = payload.conversations[0];

      if (firstConversation) {
        setActiveConversationId(firstConversation.id);
      } else {
        setActiveConversationId(null);
        setActiveConversationTitle("New conversation");
        setMessages(initialMessages);
      }

      return payload.conversations;
    } catch {
      setConversationError("Could not load conversations.");
      return [];
    } finally {
      setIsLoadingConversations(false);
    }
  }

  async function loadConversation(conversationId: string) {
    setIsLoadingMessages(true);
    setConversationError(null);
    setIsSourcesPanelOpen(false);
    setActiveCitationMessageId(null);

    try {
      const response = await fetch(
        `/api/recruiter-conversations/${conversationId}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | {
            conversation?: { title: string };
            messages?: ChatMessage[];
            error?: string;
          }
        | undefined;

      if (!response.ok || !payload?.conversation || !payload.messages) {
        setConversationError(
          payload?.error ?? "Could not load conversation messages.",
        );
        return;
      }

      setActiveConversationId(conversationId);
      setActiveConversationTitle(payload.conversation.title);
      setMessages(payload.messages.length > 0 ? payload.messages : initialMessages);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "recruiterActiveConversationId",
          conversationId,
        );
      }
    } catch {
      setConversationError("Could not load conversation messages.");
    } finally {
      setIsLoadingMessages(false);
    }
  }

  async function createConversation() {
    setIsCreatingConversation(true);
    setConversationError(null);

    try {
      const response = await fetch("/api/recruiter-conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const payload = (await response.json()) as
        | { conversation?: ConversationSummary; error?: string }
        | undefined;

      if (!response.ok || !payload?.conversation) {
        setConversationError(payload?.error ?? "Could not create conversation.");
        return null;
      }

      const nextConversations = [payload.conversation, ...conversations];
      setConversations(nextConversations);
      skipNextConversationLoadRef.current = payload.conversation.id;
      setActiveConversationId(payload.conversation.id);
      setActiveConversationTitle(payload.conversation.title);
      setMessages(initialMessages);
      setPrompt("");
      setIsSourcesPanelOpen(false);
      setActiveCitationMessageId(null);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "recruiterActiveConversationId",
          payload.conversation.id,
        );
      }

      return payload.conversation.id;
    } catch {
      setConversationError("Could not create conversation.");
      return null;
    } finally {
      setIsCreatingConversation(false);
    }
  }

  async function resetConversation(conversationId: string) {
    const confirmed = window.confirm(
      "Clear this conversation and start fresh?",
    );
    if (!confirmed) return;

    setConversationError(null);

    try {
      const response = await fetch(
        `/api/recruiter-conversations/${conversationId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "reset" }),
        },
      );

      const payload = (await response.json()) as { error?: string } | undefined;

      if (!response.ok) {
        setConversationError(payload?.error ?? "Could not reset conversation.");
        return;
      }

      setMessages(initialMessages);
      await loadConversations(conversationId);
      await loadConversation(conversationId);
    } catch {
      setConversationError("Could not reset conversation.");
    }
  }

  async function deleteConversation(conversationId: string) {
    const confirmed = window.confirm("Delete this conversation?");
    if (!confirmed) return;

    setConversationError(null);

    try {
      const response = await fetch(
        `/api/recruiter-conversations/${conversationId}`,
        {
          method: "DELETE",
        },
      );

      const payload = (await response.json()) as { error?: string } | undefined;

      if (!response.ok) {
        setConversationError(payload?.error ?? "Could not delete conversation.");
        return;
      }

      const remainingConversations = conversations.filter(
        (conversation) => conversation.id !== conversationId,
      );
      setConversations(remainingConversations);

      if (activeConversationId === conversationId) {
        const nextConversation = remainingConversations[0] ?? null;

        if (nextConversation) {
          await loadConversation(nextConversation.id);
        } else {
          setActiveConversationId(null);
          setActiveConversationTitle("New conversation");
          setMessages(initialMessages);
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("recruiterActiveConversationId");
          }
        }
      }
    } catch {
      setConversationError("Could not delete conversation.");
    }
  }

  async function deleteCvFile(fileId: string) {
    const confirmed = window.confirm(
      "Delete this CV from the knowledge base?",
    );
    if (!confirmed) return;

    setListError(null);

    try {
      const response = await fetch(`/api/uploads/${fileId}`, {
        method: "DELETE",
      });

      const payload = (await response.json()) as { error?: string } | undefined;

      if (!response.ok) {
        setListError(payload?.error ?? "Could not delete CV.");
        return;
      }

      setFiles((current) => current.filter((file) => file.id !== fileId));
    } catch {
      setListError("Could not delete CV.");
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || isReplying) return;

    let conversationId = activeConversationId;

    if (!conversationId) {
      conversationId = await createConversation();
      if (!conversationId) return;
    }

    const userMessage = makeMessage("user", text);
    const historyForRequest = [...messages, userMessage];

    setMessages(historyForRequest);
    setPrompt("");
    setIsReplying(true);
    setConversationError(null);

    try {
      const response = await fetch("/api/recruiter-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          question: text,
          messages: historyForRequest.map((message) => ({
            role: message.sender === "assistant" ? "assistant" : "user",
            content: message.text,
          })),
        }),
      });

      const payload = (await response.json()) as
        | {
            reply?: string;
            citations?: Citation[];
            error?: string;
          }
        | undefined;

      if (!response.ok || !payload?.reply) {
        setMessages((current) => [
          ...current,
          makeMessage(
            "assistant",
            payload?.error ?? "I could not answer from the CV knowledge base.",
          ),
        ]);
        return;
      }

      const replyText = payload.reply;

      setMessages((current) => [
        ...current,
        makeMessage("assistant", replyText, payload.citations ?? []),
      ]);

      await loadConversations(conversationId);
      await loadConversation(conversationId);
    } catch {
      setMessages((current) => [
        ...current,
        makeMessage("assistant", "Could not reach the recruiter chat endpoint."),
      ]);
    } finally {
      setIsReplying(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function openSourcesPanel(messageId: string) {
    setActiveCitationMessageId(messageId);
    setIsSourcesPanelOpen(true);
  }

  useEffect(() => {
    void loadFiles();
    void loadConversations();
  }, []);

  useEffect(() => {
    if (!activeConversationId) return;
    if (skipNextConversationLoadRef.current === activeConversationId) {
      skipNextConversationLoadRef.current = null;
      return;
    }
    void loadConversation(activeConversationId);
  }, [activeConversationId]);

  return (
    <main className="flex h-screen overflow-hidden bg-[#212121] text-[#ececec]">
      <aside className="hidden w-[300px] shrink-0 flex-col border-r border-white/10 bg-[#171717] md:flex">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold">PilotPulse</div>
          <button
            type="button"
            onClick={() => void createConversation()}
            disabled={isCreatingConversation}
            className="mt-3 flex h-10 w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-sm text-zinc-100 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            New conversation
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Conversations
          </div>
          <div className="mt-3 space-y-2">
            {isLoadingConversations ? (
              <p className="px-2 text-xs text-zinc-400">Loading conversations...</p>
            ) : null}
            {conversationError ? (
              <p className="px-2 text-xs text-red-300">{conversationError}</p>
            ) : null}
            {!isLoadingConversations && conversations.length === 0 ? (
              <p className="px-2 text-xs text-zinc-400">
                No conversations yet.
              </p>
            ) : null}
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId;

              return (
                <div
                  key={conversation.id}
                  className={`relative rounded-lg border px-2.5 py-2 ${
                    isActive
                      ? "border-white/15 bg-white/[0.08]"
                      : "border-white/5 bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => void loadConversation(conversation.id)}
                      className="block min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium text-zinc-100">
                        {conversation.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">
                        {conversation.lastMessagePreview
                          ? normalizePreview(conversation.lastMessagePreview)
                          : "No messages yet."}
                      </p>
                      <p className="mt-1.5 text-[11px] text-zinc-500">
                        {formatDate(
                          conversation.lastMessageAt ?? conversation.updatedAt,
                        )}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenConversationMenuId((current) =>
                          current === conversation.id ? null : conversation.id,
                        )
                      }
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                      aria-label="Conversation options"
                    >
                      ⋯
                    </button>
                  </div>
                  {openConversationMenuId === conversation.id ? (
                    <div className="absolute right-2 top-10 z-10 min-w-[120px] rounded-lg border border-white/10 bg-[#202020] p-1 shadow-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenConversationMenuId(null);
                          void resetConversation(conversation.id);
                        }}
                        className="block w-full rounded-md px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/[0.06]"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenConversationMenuId(null);
                          void deleteConversation(conversation.id);
                        }}
                        className="block w-full rounded-md px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/[0.06]"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-6 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500">
              <span>Knowledge base</span>
              <button
                type="button"
                onClick={() => void loadFiles()}
                className="text-zinc-300 hover:text-white"
              >
                Refresh
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {isLoadingFiles ? (
                <p className="px-2 text-xs text-zinc-400">Loading CVs...</p>
              ) : null}
              {listError ? (
                <p className="px-2 text-xs text-red-300">{listError}</p>
              ) : null}
              {!isLoadingFiles && !listError && files.length === 0 ? (
                <p className="px-2 text-xs text-zinc-400">No CVs loaded yet.</p>
              ) : null}
              {visibleFiles.map((file) => (
                <div
                  key={file.id}
                  className="relative rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2"
                >
                  <div className="flex items-start gap-2">
                    <a
                      href={file.fileUrl ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      aria-disabled={!file.fileUrl}
                      className={`block min-w-0 flex-1 rounded-md px-1.5 py-0.5 ${
                        file.fileUrl
                          ? "hover:bg-white/[0.05]"
                          : "cursor-not-allowed opacity-60"
                      }`}
                    >
                      <p className="truncate text-sm text-zinc-200">
                        {file.candidateName ?? file.originalFilename}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {formatBytes(file.fileSizeBytes)} / {formatDate(file.uploadedAt)}
                      </p>
                    </a>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenFileMenuId((current) =>
                          current === file.id ? null : file.id,
                        )
                      }
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
                      aria-label="CV options"
                    >
                      ⋯
                    </button>
                  </div>
                  {openFileMenuId === file.id ? (
                    <div className="absolute right-2 top-10 z-10 min-w-[120px] rounded-lg border border-white/10 bg-[#202020] p-1 shadow-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenFileMenuId(null);
                          void deleteCvFile(file.id);
                        }}
                        className="block w-full rounded-md px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/[0.06]"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
              {files.length > 8 ? (
                <button
                  type="button"
                  onClick={() => setShowAllFiles((current) => !current)}
                  className="w-full rounded-lg px-2 py-2 text-left text-xs text-zinc-300 hover:bg-white/[0.05]"
                >
                  {showAllFiles ? "See less" : `See ${files.length - 8} more`}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              {activeConversationSummary?.title ?? activeConversationTitle}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {activeConversationId ? (
              <>
                <button
                  type="button"
                  onClick={() => void resetConversation(activeConversationId)}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.05]"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => void deleteConversation(activeConversationId)}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.05]"
                >
                  Delete
                </button>
              </>
            ) : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            {isLoadingMessages ? (
              <div className="text-sm text-zinc-400">Loading conversation...</div>
            ) : null}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`flex gap-4 ${
                  message.sender === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.sender === "assistant" ? (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#10a37f] text-xs font-semibold text-white">
                    PP
                  </div>
                ) : null}
                <div className="max-w-[78%]">
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${
                      message.sender === "user"
                        ? "bg-[#2f2f2f] text-zinc-100"
                        : "bg-transparent text-zinc-100"
                    }`}
                  >
                    {renderMessageText(message.text)}
                  </div>
                  {message.sender === "assistant" &&
                  message.citations &&
                  message.citations.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2 pl-4">
                      {getResumeLinks(message.citations).map((resume) => (
                        <a
                          key={resume.cvFileId}
                          href={resume.fileUrl ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          aria-disabled={!resume.fileUrl}
                          className={`inline-flex max-w-full items-center rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-200 ${
                            resume.fileUrl
                              ? "bg-white/[0.04] hover:bg-white/[0.08]"
                              : "cursor-not-allowed bg-white/[0.02] opacity-60"
                          }`}
                          title={resume.label}
                        >
                          <span className="truncate">
                            View resume: {resume.label}
                          </span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {message.sender === "assistant" &&
                  message.citations &&
                  message.citations.length > 0 ? (
                    <div className="relative mt-2 flex items-center gap-2 pl-4">
                      <button
                        type="button"
                        onClick={() => openSourcesPanel(message.id)}
                        className="group relative inline-flex h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs text-zinc-300 hover:bg-white/[0.08] hover:text-zinc-100"
                        aria-label={`Show ${message.citations.length} sources`}
                      >
                        <span className="text-sm leading-none">↗</span>
                        <span>{message.citations.length}</span>
                        <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#111111] px-2 py-1 text-xs text-zinc-100 shadow-lg group-hover:block">
                          Sources
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
            {isReplying ? (
              <article className="flex justify-start gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#10a37f] text-xs font-semibold text-white">
                  PP
                </div>
                <div className="max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 text-zinc-400">
                  Thinking...
                </div>
              </article>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4">
          <form
            onSubmit={submitMessage}
            className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-3xl border border-white/10 bg-[#2f2f2f] p-2 shadow-lg"
          >
            <textarea
              rows={1}
              value={prompt}
              onKeyDown={handleComposerKeyDown}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask about uploaded CVs"
              className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            <button
              type="submit"
              disabled={isReplying}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-lg font-semibold text-[#212121] hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send message"
              title="Send"
            >
              →
            </button>
          </form>
        </div>
      </section>

      {isSourcesPanelOpen ? (
        <aside className="fixed inset-y-0 right-0 z-20 flex w-full max-w-[380px] flex-col border-l border-white/10 bg-[#171717] shadow-2xl md:relative md:z-auto md:h-screen md:w-[360px] md:shrink-0 md:shadow-none">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
            <h2 className="text-sm font-semibold">Sources</h2>
            <button
              type="button"
              onClick={() => setIsSourcesPanelOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-300 hover:bg-white/10 hover:text-white"
              aria-label="Close sources"
              title="Close"
            >
              ×
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {activeCitations.length === 0 ? (
              <p className="text-sm text-zinc-400">No sources selected.</p>
            ) : (
              <div className="space-y-3">
                {activeCitations.map((citation, index) => (
                  <a
                    key={`${citation.cvFileId}-${citation.chunkIndex}-${index}`}
                    href={citation.fileUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    aria-disabled={!citation.fileUrl}
                    className={`block rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm ${
                      citation.fileUrl
                        ? "hover:bg-white/[0.08]"
                        : "cursor-not-allowed opacity-70"
                    }`}
                  >
                    <span className="block truncate font-medium text-zinc-100">
                      {citation.candidateName}
                    </span>
                    <span className="mt-1 block truncate text-xs text-zinc-400">
                      {citation.filename} / chunk {citation.chunkIndex}
                    </span>
                    <span className="mt-2 block text-xs text-zinc-500">
                      Score {formatScore(citation.rerankScore ?? citation.score)} / Dense{" "}
                      {formatScore(citation.denseScore)} / Sparse{" "}
                      {formatScore(citation.sparseScore)}
                    </span>
                    <span className="mt-3 block text-xs leading-5 text-zinc-300">
                      {citation.snippet}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </aside>
      ) : null}
    </main>
  );
}
