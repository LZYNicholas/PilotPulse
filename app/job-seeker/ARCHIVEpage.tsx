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
  const [isDraggingFile, setIsDraggingFile] = useState(false);

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
      setMessages((current) => [
        ...current,
        makeMessage(
          "assistant",
          "Thanks. Please reply with your full name, phone number, and email.",
        ),
      ]);
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

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    await uploadFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    setMessages((current) => [
      ...current,
      makeMessage("user", text),
      makeMessage("assistant", "Thanks. I have received your details."),
    ]);
    setPrompt("");
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
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
              disabled={isUploading}
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
              disabled={isUploading}
            />
            <textarea
              rows={1}
              value={prompt}
              onKeyDown={handleComposerKeyDown}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Reply with your contact details"
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
