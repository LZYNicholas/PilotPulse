"use client";

import { FormEvent, KeyboardEvent, useEffect, useState } from "react";

type Sender = "assistant" | "user";

type ChatMessage = {
  id: string;
  sender: Sender;
  text: string;
  citations?: Citation[];
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

function formatDate(value: string) {
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

export default function RecruiterChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<RecruiterFile[]>([]);
  const [activeCitationMessageId, setActiveCitationMessageId] = useState<string | null>(
    null,
  );
  const [isSourcesPanelOpen, setIsSourcesPanelOpen] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);

  async function loadFiles() {
    setIsLoadingFiles(true);
    setListError(null);

    try {
      const response = await fetch("/api/uploads");
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

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || isReplying) return;

    const userMessage = makeMessage("user", text);

    setMessages((current) => [...current, userMessage]);
    setPrompt("");
    setIsReplying(true);

    try {
      const response = await fetch("/api/recruiter-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: text,
          messages: [...messages, userMessage].map((message) => ({
            role: message.sender === "assistant" ? "assistant" : "user",
            content: message.text,
          })),
        }),
      });

      const payload = (await response.json()) as
        | { reply?: string; citations?: Citation[]; error?: string }
        | undefined;

      const reply = payload?.reply;

      if (!response.ok || !reply) {
        setMessages((current) => [
          ...current,
          makeMessage(
            "assistant",
            payload?.error ?? "I could not answer from the CV knowledge base.",
          ),
        ]);
        return;
      }

      setMessages((current) => [
        ...current,
        makeMessage("assistant", reply, payload?.citations ?? []),
      ]);
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

  const visibleFiles = showAllFiles ? files : files.slice(0, 8);
  const activeCitationMessage = messages.find(
    (message) => message.id === activeCitationMessageId,
  );
  const activeCitations = activeCitationMessage?.citations ?? [];

  function openSourcesPanel(messageId: string) {
    setActiveCitationMessageId(messageId);
    setIsSourcesPanelOpen(true);
  }

  useEffect(() => {
    let isMounted = true;

    async function loadInitialFiles() {
      try {
        const response = await fetch("/api/uploads");
        const payload = (await response.json()) as
          | { files?: RecruiterFile[]; error?: string }
          | undefined;

        if (!isMounted) return;

        if (!response.ok || !payload?.files) {
          setListError(payload?.error ?? "Could not load CVs.");
          return;
        }

        setFiles(payload.files);
      } catch {
        if (isMounted) setListError("Could not load CVs.");
      }
    }

    void loadInitialFiles();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="flex h-screen overflow-hidden bg-[#212121] text-[#ececec]">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-white/10 bg-[#171717] p-3 md:flex">
        <div className="px-3 py-2 text-sm font-semibold">PilotPulse</div>
        <div className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-sm text-white">
          Recruiter chat
        </div>

        <div className="mt-6 space-y-2 px-3 text-xs text-zinc-400">
          <div className="flex items-center justify-between">
            <span>Knowledge base</span>
            <button
              type="button"
              onClick={() => void loadFiles()}
              className="text-zinc-200 hover:text-white"
            >
              Refresh
            </button>
          </div>
          {isLoadingFiles ? <p>Loading CVs...</p> : null}
          {listError ? <p className="text-red-300">{listError}</p> : null}
          {!isLoadingFiles && !listError && files.length === 0 ? (
            <p>No CVs loaded yet.</p>
          ) : null}
          {visibleFiles.map((file) => (
            <a
              key={file.id}
              href={file.fileUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!file.fileUrl}
              className={`block rounded-md bg-white/5 p-2 ${
                file.fileUrl ? "hover:bg-white/10" : "cursor-not-allowed opacity-60"
              }`}
            >
              <p className="truncate text-zinc-200">
                {file.candidateName ?? file.originalFilename}
              </p>
              <p className="truncate">
                {formatBytes(file.fileSizeBytes)} / {formatDate(file.uploadedAt)}
              </p>
            </a>
          ))}
          {files.length > 8 ? (
            <button
              type="button"
              onClick={() => setShowAllFiles((current) => !current)}
              className="w-full rounded-md px-2 py-2 text-left text-xs text-zinc-200 hover:bg-white/5"
            >
              {showAllFiles ? "See less" : `See ${files.length - 8} more`}
            </button>
          ) : null}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-center border-b border-white/10 px-4">
          <h1 className="text-sm font-semibold">Recruiter chat</h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
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
                    {message.text}
                  </div>
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
