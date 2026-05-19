"use client";

import { ChangeEvent, FormEvent, useState } from "react";

type AttachedFile = {
  id: string;
  file: File;
};

const starterConversations = [
  { title: "CV comparison shortlist", messages: "12 messages", active: true },
  { title: "Python candidates", messages: "6 messages", active: false },
  { title: "Frontend hiring notes", messages: "4 messages", active: false },
  { title: "Resume scoring test", messages: "9 messages", active: false },
];

const starterPrompts = [
  {
    title: "Compare candidates",
    copy: "Who has the strongest Python and analytics background?",
  },
  {
    title: "Find skill gaps",
    copy: "Which applicants are missing production cloud experience?",
  },
  {
    title: "Create a shortlist",
    copy: "Give me the top 3 candidates for a backend intern role.",
  },
  {
    title: "Surface evidence",
    copy: "Show the exact resume snippets that support your ranking.",
  },
];

const starterMessages = [
  {
    role: "assistant",
    avatar: "PP",
    content:
      "I can analyze uploaded CVs, cite supporting snippets, and compare candidates across the shared knowledge base.",
  },
  {
    role: "user",
    avatar: "U",
    content:
      "I need a shortlist for a data intern opening. Focus on Python, SQL, and dashboards.",
  },
  {
    role: "assistant",
    avatar: "PP",
    content:
      "Upload the resumes you want me to review, and I'll rank them using those criteria and cite the relevant sections from each document.",
  },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);

    setFiles((current) => {
      const next = [...current];

      selectedFiles.forEach((file) => {
        const exists = next.some(
          (entry) =>
            entry.file.name === file.name &&
            entry.file.size === file.size &&
            entry.file.lastModified === file.lastModified,
        );

        if (!exists) {
          next.push({
            id: `${file.name}-${file.lastModified}-${file.size}`,
            file,
          });
        }
      });

      return next;
    });

    event.target.value = "";
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.05),_transparent_25%),_#212121] text-zinc-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-[260px] shrink-0 border-r border-white/8 bg-[#171717] p-3 lg:flex lg:flex-col">
          <div className="space-y-2">
            <button className="flex w-full items-center gap-3 rounded-2xl bg-white/8 px-4 py-3 text-left text-sm font-medium hover:bg-white/12">
              <span className="inline-flex w-4 justify-center">+</span>
              <span>New chat</span>
            </button>
            <button className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-zinc-300 hover:bg-white/7">
              <span className="inline-flex w-4 justify-center">☰</span>
              <span>Library</span>
            </button>
          </div>

          <div className="mt-6 space-y-6">
            <section className="space-y-2">
              <p className="px-3 text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                Today
              </p>
              {starterConversations.slice(0, 2).map((conversation) => (
                <button
                  key={conversation.title}
                  className={`flex w-full flex-col items-start gap-1 rounded-2xl px-3 py-2.5 text-left hover:bg-white/7 ${
                    conversation.active ? "bg-white/8" : ""
                  }`}
                >
                  <span className="text-sm">{conversation.title}</span>
                  <span className="text-xs text-zinc-400">
                    {conversation.messages}
                  </span>
                </button>
              ))}
            </section>

            <section className="space-y-2">
              <p className="px-3 text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                Previous 7 Days
              </p>
              {starterConversations.slice(2).map((conversation) => (
                <button
                  key={conversation.title}
                  className="flex w-full flex-col items-start gap-1 rounded-2xl px-3 py-2.5 text-left hover:bg-white/7"
                >
                  <span className="text-sm">{conversation.title}</span>
                  <span className="text-xs text-zinc-400">
                    {conversation.messages}
                  </span>
                </button>
              ))}
            </section>
          </div>

          <div className="mt-auto rounded-3xl border border-white/8 bg-white/[0.03] p-4 text-sm text-zinc-300">
            <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">
              Workspace
            </p>
            <p className="mt-2 font-semibold text-zinc-100">
              Shared CV Knowledge Base
            </p>
            <p className="mt-2 leading-6">
              Upload resumes and ask grounded questions across every document.
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between px-4 py-4 sm:px-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                PilotPulse
              </p>
              <h1 className="mt-1 text-xl font-semibold">Resume Analyzer</h1>
            </div>
            <div className="hidden gap-2 sm:flex">
              <button className="rounded-full border border-white/8 px-4 py-2.5 text-sm hover:bg-white/7">
                Share
              </button>
              <button className="rounded-full bg-white px-4 py-2.5 text-sm font-medium text-zinc-950 hover:opacity-90">
                Upgrade
              </button>
            </div>
          </header>

          <section className="flex-1 overflow-y-auto px-4 pb-3 sm:px-6">
            <div className="mx-auto w-full max-w-[860px]">
              <div className="px-2 pb-8 pt-6 text-center sm:px-0 sm:pt-10">
                <div className="inline-flex rounded-full bg-white/8 px-4 py-2 text-sm text-zinc-300">
                  Knowledge Base Ready
                </div>
                <h2 className="mx-auto mt-4 max-w-4xl text-balance text-4xl font-semibold leading-tight sm:text-5xl">
                  Upload resumes, then ask questions like you would in ChatGPT.
                </h2>
                <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-zinc-400">
                  Drag in PDF or DOCX files, keep them attached to the current
                  conversation, and ask for comparisons, strengths, weaknesses,
                  or ranking suggestions.
                </p>
              </div>

              <div className="grid gap-3 pb-8 md:grid-cols-2">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt.title}
                    className="rounded-3xl border border-white/8 bg-white/[0.04] p-5 text-left shadow-[0_12px_28px_rgba(0,0,0,0.28)] transition hover:-translate-y-0.5 hover:bg-white/[0.07]"
                  >
                    <span className="block text-sm font-semibold">
                      {prompt.title}
                    </span>
                    <span className="mt-2 block text-sm leading-6 text-zinc-400">
                      {prompt.copy}
                    </span>
                  </button>
                ))}
              </div>

              <div className="space-y-6 pb-8">
                {starterMessages.map((item, index) => (
                  <article key={`${item.role}-${index}`} className="flex gap-4">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                        item.role === "assistant"
                          ? "bg-zinc-100 text-zinc-950"
                          : "bg-zinc-700 text-zinc-100"
                      }`}
                    >
                      {item.avatar}
                    </div>
                    <div className="pt-1">
                      <p className="text-[15px] leading-7 text-zinc-100">
                        {item.content}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="px-4 pb-4 sm:px-6 sm:pb-6">
            <div className="mx-auto w-full max-w-[860px]">
              <div className="rounded-t-3xl border border-b-0 border-white/8 bg-white/[0.03] px-4 pb-3 pt-4">
                <div className="mb-3 flex items-center justify-between gap-4 text-sm text-zinc-300">
                  <span>Attached documents</span>
                  <button
                    type="button"
                    className="rounded-full px-3 py-1.5 text-zinc-400 hover:bg-white/7 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setFiles([])}
                    disabled={files.length === 0}
                  >
                    Clear all
                  </button>
                </div>

                {files.length === 0 ? (
                  <p className="text-sm text-zinc-400">
                    No documents attached yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {files.map((entry) => {
                      const extension =
                        entry.file.name.split(".").pop()?.toUpperCase() ?? "FILE";

                      return (
                        <div
                          key={entry.id}
                          className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.05] px-3 py-2.5"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/7 text-xs font-semibold">
                            {extension}
                          </div>
                          <div className="min-w-0">
                            <p className="max-w-[220px] truncate text-sm">
                              {entry.file.name}
                            </p>
                            <p className="text-xs text-zinc-400">
                              {formatBytes(entry.file.size)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <form
                onSubmit={handleSubmit}
                className="rounded-b-3xl border border-white/8 bg-[#171717] p-4 shadow-[0_12px_28px_rgba(0,0,0,0.28)]"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/8 bg-white/[0.05] px-4 py-2.5 text-sm hover:bg-white/[0.08]">
                    <span className="inline-flex w-4 justify-center">+</span>
                    <span>Add files</span>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx"
                      multiple
                      className="hidden"
                      onChange={handleFiles}
                    />
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.05] px-4 py-2.5 text-sm hover:bg-white/[0.08]"
                  >
                    Tools
                  </button>
                </div>

                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={1}
                  placeholder="Message PilotPulse"
                  className="mt-3 min-h-8 w-full resize-none bg-transparent text-base leading-7 text-zinc-100 outline-none placeholder:text-zinc-500"
                />

                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-zinc-400">
                    PDF and DOCX up to 10 MB each
                  </span>
                  <button
                    type="submit"
                    className="inline-flex h-10 w-10 items-center justify-center self-end rounded-xl bg-white text-xl text-zinc-950 hover:opacity-90"
                    aria-label="Send message"
                  >
                    ↑
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
