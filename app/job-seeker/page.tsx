"use client";

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type Sender = "assistant" | "user";
type UploadStatus = "uploading" | "uploaded" | "processing" | "ready" | "error";

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

type UploadApiResponse = {
  error?: string;
  files?: Array<{
    id: string;
    originalFilename: string;
    fileSizeBytes: number;
    fileUrl: string | null;
    uploadStatus: string;
    processingError: string | null;
  }>;
};

const initialMessages: ChatMessage[] = [
  {
    id: "job-seeker-welcome",
    sender: "assistant",
    text: "Thank you for your interest. To begin, please tell me your full name.",
  },
];

const SUPPORTED_EXTENSIONS = new Set(["pdf", "docx", "png", "jpg", "jpeg", "webp"]);
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusText(file: LocalFile) {
  if (file.status === "ready") return "Ready";
  if (file.status === "uploaded") return "Uploaded";
  if (file.status === "processing") return "Processing";
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

function createSafeUploadFilename(filename: string) {
  const extension = getFileExtension(filename);
  const basename = filename
    .replace(/\.[^/.]+$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();

  const safeBasename = basename || "cv";
  return extension ? `${safeBasename}.${extension}` : safeBasename;
}

function normalizeUploadFile(file: File) {
  const extension = getFileExtension(file.name);
  const contentType =
    file.type || EXTENSION_TO_MIME_TYPE[extension] || "application/octet-stream";

  return new File([file], createSafeUploadFilename(file.name), {
    type: contentType,
    lastModified: file.lastModified,
  });
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
  const [confirmedContact, setConfirmedContact] = useState<ContactDetails | null>(null);

  const hasConfirmedContact = Boolean(
    confirmedContact?.name && confirmedContact.phone && confirmedContact.email,
  );

  async function readJsonSafely(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";
    const responseText = await response.text();

    if (!responseText) return undefined;

    if (!contentType.includes("application/json")) {
      return { error: responseText };
    }

    try {
      return JSON.parse(responseText) as UploadApiResponse;
    } catch {
      return { error: responseText };
    }
  }

  async function refreshFileStatus(fileId: string) {
    try {
      const response = await fetch(`/api/uploads/${fileId}`, { cache: "no-store" });
      const payload = (await response.json()) as
        | {
            file?: {
              id: string;
              uploadStatus: string;
              processingError: string | null;
              fileUrl: string | null;
            };
          }
        | undefined;

      if (!response.ok || !payload?.file) {
        return;
      }

      const nextFile = payload.file;
      let completedProcessing = false;

      setLocalFiles((current) =>
        current.map((file) => {
          if (file.id !== fileId) return file;

          if (nextFile.uploadStatus === "ready") {
            completedProcessing = file.status === "processing";
            return {
              ...file,
              status: "ready",
              fileUrl: nextFile.fileUrl,
              error: undefined,
            };
          }

          if (nextFile.uploadStatus === "failed") {
            return {
              ...file,
              status: "error",
              fileUrl: nextFile.fileUrl,
              error: nextFile.processingError ?? "Upload failed",
            };
          }

          if (nextFile.uploadStatus === "uploaded") {
            return {
              ...file,
              status: "uploaded",
              fileUrl: nextFile.fileUrl,
              error: undefined,
            };
          }

          return {
            ...file,
            status: "processing",
            fileUrl: nextFile.fileUrl,
          };
        }),
      );

      if (completedProcessing) {
        setMessages((current) => [
          ...current,
          makeMessage(
            "assistant",
            "Your CV has finished processing and is ready for review.",
          ),
        ]);
      }
    } catch {
      // Best-effort polling; keep the current UI state and try again later.
    }
  }

  useEffect(() => {
    const processingFiles = localFiles.filter((file) => file.status === "processing");
    if (processingFiles.length === 0) return;

    const intervalId = window.setInterval(() => {
      processingFiles.forEach((file) => {
        void refreshFileStatus(file.id);
      });
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [localFiles]);

  async function startBackgroundProcessing(fileId: string) {
    try {
      const response = await fetch(`/api/uploads/${fileId}/process`, {
        method: "POST",
      });

      if (!response.ok) {
        const payload = (await readJsonSafely(response)) as
          | { error?: string }
          | undefined;

        setLocalFiles((current) =>
          current.map((file) =>
            file.id === fileId
              ? {
                  ...file,
                  status: "error",
                  error: payload?.error ?? "Background CV processing failed to start.",
                }
              : file,
          ),
        );
        return;
      }

      await refreshFileStatus(fileId);
    } catch {
      setLocalFiles((current) =>
        current.map((file) =>
          file.id === fileId
            ? {
                ...file,
                status: "error",
                error: "Background CV processing failed to start.",
              }
            : file,
        ),
      );
    }
  }

  async function uploadFiles(selectedFiles: File[]) {
    if (selectedFiles.length === 0) return;

    if (!hasConfirmedContact || !confirmedContact) {
      setMessages((current) => [
        ...current,
        makeMessage(
          "assistant",
          "Please confirm your full name, phone number, and email before uploading your CV.",
        ),
      ]);
      return;
    }

    const unsupportedFiles = selectedFiles.filter((file) => !isSupportedCvFile(file));

    if (unsupportedFiles.length > 0) {
      setMessages((current) => [
        ...current,
        makeMessage(
          "assistant",
          "Only PDF, DOCX, PNG, JPG, JPEG, and WEBP files can be uploaded.",
        ),
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
      formData.append("candidateName", confirmedContact.name ?? "");
      formData.append("candidatePhone", confirmedContact.phone ?? "");
      formData.append("candidateEmail", confirmedContact.email ?? "");

      selectedFiles.forEach((file) => {
        const normalizedFile = normalizeUploadFile(file);
        formData.append("files", normalizedFile, normalizedFile.name);
      });

      const response = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });

      const payload = await readJsonSafely(response);

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
          const pendingIndex = pendingFiles.findIndex((pending) => pending.id === file.id);
          if (pendingIndex === -1) return file;

          const uploadedFile = payload.files?.[pendingIndex];
          if (!uploadedFile) {
            return {
              ...file,
              status: "error",
              error: "Upload response was incomplete.",
            };
          }

          return {
            ...file,
            id: uploadedFile.id,
            status:
              uploadedFile.uploadStatus === "failed"
                ? "error"
                : uploadedFile.uploadStatus === "ready"
                  ? "ready"
                  : uploadedFile.uploadStatus === "processing"
                    ? "processing"
                    : "uploaded",
            fileUrl: uploadedFile.fileUrl,
            error: uploadedFile.processingError ?? undefined,
          };
        }),
      );

      setMessages((current) => [
        ...current,
        makeMessage(
          "assistant",
          "Your CV has been uploaded successfully. Thank you for applying for the position.",
        ),
      ]);

      await Promise.all(
        payload.files.map((file) => startBackgroundProcessing(file.id)),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : "Upload failed.";

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
    } finally {
      setIsUploading(false);
    }
  }

  // Core function that calls the chat API and handles the response.
  async function sendToAI(
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ) {
    setIsReplying(true);

    try {
      const response = await fetch("/api/job-seeker-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      const data = (await response.json()) as {
        reply?: string;
        action: "chat" | "confirm" | "save";
        contactDetails: ContactDetails | null;
        error?: string;
      };

      if (!response.ok) {
        setMessages((current) => [
          ...current,
          makeMessage(
            "assistant",
            data.error ?? data.reply ?? "Something went wrong. Please try again.",
          ),
        ]);
        return;
      }

      const replyText = data.reply ?? "Something went wrong. Please try again.";

      setMessages((current) => [
        ...current,
        makeMessage("assistant", replyText),
      ]);

      if (data.action === "confirm" && data.contactDetails) {
        setConfirmedContact(null);
      }

      if (data.action === "save" && data.contactDetails) {
        setConfirmedContact(data.contactDetails);
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

    await sendToAI(history);
  }

  // Converts ChatMessage[] into the format the Gemini API expects.
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

    if (!hasConfirmedContact) {
      setMessages((current) => [
        ...current,
        makeMessage(
          "assistant",
          "Please confirm your contact details before uploading your CV.",
        ),
      ]);
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length === 0) return;

    if (droppedFiles.some((file) => !isSupportedCvFile(file))) {
      setMessages((current) => [
        ...current,
        makeMessage(
          "assistant",
          "Only PDF, DOCX, PNG, JPG, JPEG, and WEBP files can be uploaded.",
        ),
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
            {hasConfirmedContact
              ? "Drop PDF, DOCX, or CV image to upload"
              : "Confirm your contact details first"}
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
              disabled={isUploading || isReplying || !hasConfirmedContact}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-zinc-200 hover:bg-white/10 disabled:opacity-50"
              aria-label="Upload CV"
              title={hasConfirmedContact ? "Upload CV" : "Confirm contact details first"}
            >
              +
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={handleUpload}
              disabled={isUploading || isReplying || !hasConfirmedContact}
            />
            <textarea
              rows={1}
              value={prompt}
              onKeyDown={handleComposerKeyDown}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={isReplying}
              placeholder={
                hasConfirmedContact
                  ? "Upload your CV or reply here..."
                  : "Reply with your contact details..."
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
