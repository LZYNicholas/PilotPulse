"use client";

import { FormEvent, KeyboardEvent, useEffect, useState } from "react";

type Sender = "assistant" | "user";

type ChatMessage = {
  id: string;
  sender: Sender;
  text: string;
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

function makeMessage(sender: Sender, text: string): ChatMessage {
  return {
    id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sender,
    text,
  };
}

export default function RecruiterChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<RecruiterFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
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

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    setMessages((current) => [
      ...current,
      makeMessage("user", text),
      makeMessage(
        "assistant",
        `I will answer using ${files.length} uploaded CV${
          files.length === 1 ? "" : "s"
        } in the knowledge base.`,
      ),
    ]);
    setPrompt("");
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const visibleFiles = showAllFiles ? files : files.slice(0, 8);

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
                <div
                  className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${
                    message.sender === "user"
                      ? "bg-[#2f2f2f] text-zinc-100"
                      : "bg-transparent text-zinc-100"
                  }`}
                >
                  {message.text}
                </div>
              </article>
            ))}
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
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-lg font-semibold text-[#212121] hover:bg-zinc-200"
              aria-label="Send message"
              title="Send"
            >
              →
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
