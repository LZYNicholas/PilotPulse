"use client";

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useRef,
  useState,
} from "react";

type Sender = "assistant" | "user";
type UploadStatus = "uploading" | "uploaded" | "error";

type ChatMessage = {
  id: string;
  sender: Sender;
  text: string;
};

type LocalFile = {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  fileUrl?: string | null;
  error?: string;
};

type ContactDetails = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

const initialMessages: ChatMessage[] = [
  {
    id: "job-seeker-welcome",
    sender: "assistant",
    text: "Upload your CV, then I will ask for your name, phone number, and email.",
  },
];

const SUPPORTED_EXTENSIONS = new Set(["pdf", "docx"]);
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusText(file: LocalFile) {
  if (file.status === "uploaded") return "Uploaded";
  if (file.status === "uploading") return "Uploading";
  return file.error ?? "Upload failed";
}

function makeMessage(sender: Sender, text: string): ChatMessage {
  return {
    id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sender,
    text,
  };
}

function getFileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function isSupportedCvFile(file: File) {
  return (
    SUPPORTED_EXTENSIONS.has(getFileExtension(file.name)) &&
    SUPPORTED_MIME_TYPES.has(file.type)
  );
}

function hasUnsupportedDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.items).some((item) => {
    if (item.kind !== "file") return false;
    const extension = getFileExtension(item.getAsFile()?.name ?? "");
    return !SUPPORTED_MIME_TYPES.has(item.type) && !SUPPORTED_EXTENSIONS.has(extension);
  });
}

export default function JobSeekerChat() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Tracks which cv_files row the current conversation is about.
  // Set when upload succeeds, used when sending messages and saving contact details.
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  // Holds confirmed contact details while waiting for user to say yes/no.
  const [pendingContact, setPendingContact] = useState<ContactDetails | null>(null);

  async function uploadFiles(selectedFiles: File[]) {
    if (selectedFiles.length === 0) return;

    const unsupportedFiles = selectedFiles.filter((file) => !isSupportedCvFile(file));

    if (unsupportedFiles.length > 0) {
      setMessages((current) => [
        ...current,
        makeMessage("assistant", "Only PDF and DOCX files can be uploaded."),
      ]);
      return;
    }

    const pendingFiles = selectedFiles.map((file) => ({
      id: `${file.name}-${file.lastModified}-${file.size}`,
      name: file.name,
      size: file.size,
      status: "uploading" as const,
    }));

    setIsUploading(true);
    setLocalFiles((current) => [...pendingFiles, ...current]);
    setMessages((current) => [
      ...current,
      makeMessage(
        "user",
        `Uploaded ${selectedFiles.map((file) => file.name).join(", ")}`,
      ),
    ]);

    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => formData.append("files", file));

      const response = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as
        | {
            error?: string;
            files?: Array<{
              id: string;
              originalFilename: string;
              fileSizeBytes: number;
              fileUrl: string | null;
            }>;
          }
        | undefined;

      if (!response.ok || !payload?.files) {
        const errorMessage = payload?.error ?? "Upload failed.";

        setLocalFiles((current) =>
          current.map((file) =>
            pendingFiles.some((pending) => pending.id === file.id)
              ? { ...file, status: "error", error: errorMessage }
              : file,
          ),
        );
        setMessages((current) => [
          ...current,
          makeMessage("assistant", errorMessage),
        ]);
        return;
      }

      // Store the first uploaded file's Supabase UUID as the active CV.
      // If multiple files are uploaded at once, we track the first one.
      const firstUploadedId = payload.files[0]?.id ?? null;
      setActiveFileId(firstUploadedId);

      // Reset any pending contact details from a previous upload session.
      setPendingContact(null);

      setLocalFiles((current) =>
        current.map((file) => {
          const uploadedFile = payload.files?.find(
            (entry) =>
              entry.originalFilename === file.name &&
              entry.fileSizeBytes === file.size,
          );

          if (!uploadedFile) return file;

          return {
            ...file,
            id: uploadedFile.id,
            status: "uploaded",
            fileUrl: uploadedFile.fileUrl,
            error: undefined,
          };
        }),
      );

      // Kick off the AI conversation now that we have a file ID.
      // Pass the upload event as the first user turn so Claude has context.
      await sendToAI(
        [{ role: "user", content: "I just uploaded my CV." }],
        firstUploadedId,
      );
    } catch {
      setLocalFiles((current) =>
        current.map((file) =>
          pendingFiles.some((pending) => pending.id === file.id)
            ? { ...file, status: "error", error: "Upload failed." }
            : file,
        ),
      );
      setMessages((current) => [
        ...current,
        makeMessage("assistant", "Upload failed."),
      ]);
    } finally {
      setIsUploading(false);
    }
  }

  // Core function that calls the chat API and handles the response.
  async function sendToAI(
    history: Array<{ role: "user" | "assistant"; content: string }>,
    fileId: string | null,
  ) {
    if (!fileId) return;

    setIsReplying(true);

    try {
      const response = await fetch("/api/job-seeker-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, cvFileId: fileId }),
      });

      const data = (await response.json()) as {
        reply: string;
        action: "chat" | "confirm" | "save";
        contactDetails: ContactDetails | null;
      };

      if (!response.ok) {
        setMessages((current) => [
          ...current,
          makeMessage("assistant", data.reply ?? "Something went wrong. Please try again."),
        ]);
        return;
      }

      setMessages((current) => [
        ...current,
        makeMessage("assistant", data.reply),
      ]);

      // If Claude has all details and is asking the user to confirm, hold them in state.
      if (data.action === "confirm" && data.contactDetails) {
        setPendingContact(data.contactDetails);
      }

      // If user confirmed and Claude says save, write to the database.
      if (data.action === "save" && data.contactDetails) {
        await saveContactDetails(data.contactDetails, fileId);
      }
    } catch {
      setMessages((current) => [
        ...current,
        makeMessage("assistant", "Something went wrong. Please try again."),
      ]);
    } finally {
      setIsReplying(false);
    }
  }

  async function saveContactDetails(details: ContactDetails, fileId: string) {
    try {
      const response = await fetch("/api/job-seeker-chat/save-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cvFileId: fileId,
          name: details.name,
          phone: details.phone,
          email: details.email,
        }),
      });

      const data = (await response.json()) as { success?: boolean; error?: string };

      if (!response.ok || !data.success) {
        setMessages((current) => [
          ...current,
          makeMessage(
            "assistant",
            `I couldn't save your details: ${data.error ?? "unknown error"}. Please try again.`,
          ),
        ]);
        return;
      }

      // Clear pending contact now that save succeeded.
      setPendingContact(null);

      setMessages((current) => [
        ...current,
        makeMessage(
          "assistant",
          "All done! Your contact details have been saved. Good luck with your application!",
        ),
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        makeMessage(
          "assistant",
          "I couldn't save your details due to a network error. Please try again.",
        ),
      ]);
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || isReplying) return;

    // Add user message to UI immediately.
    const userMessage = makeMessage("user", text);
    setMessages((current) => [...current, userMessage]);
    setPrompt("");

    // Build the full conversation history to send to the API.
    // We reconstruct from current messages plus the new user turn.
    const history = buildHistory([...messages, userMessage]);

    await sendToAI(history, activeFileId);
  }

  // Converts ChatMessage[] into the format the Anthropic API expects.
  // Filters out the initial welcome message (which has no matching assistant role).
  function buildHistory(
    msgs: ChatMessage[],
  ): Array<{ role: "user" | "assistant"; content: string }> {
    return msgs
      .filter((m) => m.id !== "job-seeker-welcome")
      .map((m) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.text,
      }));
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    await uploadFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingFile(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = hasUnsupportedDraggedFiles(event) ? "none" : "copy";
    setIsDraggingFile(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDraggingFile(false);
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingFile(false);

    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length === 0) return;

    if (droppedFiles.some((file) => !isSupportedCvFile(file))) {
      setMessages((current) => [
        ...current,
        makeMessage("assistant", "Only PDF and DOCX files can be uploaded."),
      ]);
      return;
    }

    await uploadFiles(droppedFiles);
  }

  return (
    <main
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex h-screen overflow-hidden bg-[#212121] text-[#ececec] ${
        isDraggingFile ? "outline outline-2 outline-inset outline-[#10a37f]" : ""
      }`}
    >
      {isDraggingFile ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[#212121]/75">
          <div className="rounded-2xl border border-[#10a37f] bg-[#283f39] px-6 py-4 text-sm font-medium text-white shadow-2xl">
            Drop PDF or DOCX to upload
          </div>
        </div>
      ) : null}

      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-white/10 bg-[#171717] p-3 md:flex">
        <div className="px-3 py-2 text-sm font-semibold">PilotPulse</div>
        <div className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-sm text-white">
          Job seeker chat
        </div>
        <div className="mt-6 space-y-2 px-3 text-xs text-zinc-400">
          {localFiles.length === 0 ? (
            <p>No CV uploaded yet.</p>
          ) : (
            localFiles.slice(0, 6).map((file) => (
              <a
                key={file.id}
                href={file.fileUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!file.fileUrl}
                className={`block truncate rounded-md bg-white/5 p-2 ${
                  file.fileUrl ? "hover:bg-white/10" : "cursor-default"
                }`}
              >
                <span className="block truncate text-zinc-200">{file.name}</span>
                <span className="block truncate">
                  {formatBytes(file.size)} / {statusText(file)}
                </span>
              </a>
            ))
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-center border-b border-white/10 px-4">
          <h1 className="text-sm font-semibold">Job seeker chat</h1>
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

            {/* Typing indicator shown while waiting for AI reply */}
            {isReplying ? (
              <article className="flex gap-4 justify-start">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#10a37f] text-xs font-semibold text-white">
                  PP
                </div>
                <div className="flex items-center gap-1 rounded-2xl px-4 py-3">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isReplying}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-zinc-200 hover:bg-white/10 disabled:opacity-50"
              aria-label="Upload CV"
              title="Upload CV"
            >
              +
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={handleUpload}
              disabled={isUploading || isReplying}
            />
            <textarea
              rows={1}
              value={prompt}
              onKeyDown={handleComposerKeyDown}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={isReplying}
              placeholder={
                activeFileId
                  ? "Reply here..."
                  : "Upload a CV to get started"
              }
              className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isReplying || !prompt.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-lg font-semibold text-[#212121] hover:bg-zinc-200 disabled:opacity-50"
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
