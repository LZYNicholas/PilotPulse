# Database Schema: PilotPulse CV Analyzer

This schema matches the agreed stack:

- `Supabase Postgres` for structured app data
- `Supabase Storage` for original CV files
- `Pinecone` for vector embeddings
- `OpenAI` for chat + embeddings

The goal is to support:

- CV upload, listing, preview, and deletion
- ingestion status tracking
- multi-conversation chat history
- grounded citations back to specific CV chunks

## 1. Core Design

Use PostgreSQL for metadata and application state, and Pinecone for semantic retrieval.

Postgres stores:

- CV file metadata
- extracted CV text metadata
- chunk records and Pinecone IDs
- conversations
- messages
- message citations

Pinecone stores:

- embedding vectors for each CV chunk
- lightweight metadata used for retrieval filtering and citations

## 2. Entity Relationships

```text
cv_files
  -> cv_chunks
  -> conversation_message_citations

conversations
  -> messages

messages
  -> conversation_message_citations
```

## 3. PostgreSQL Tables

### 3.1 `cv_files`

One row per uploaded CV.

```sql
create table cv_files (
    id uuid primary key default gen_random_uuid(),
    original_filename text not null,
    storage_bucket text not null default 'cv-uploads',
    storage_path text not null unique,
    mime_type text not null,
    file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),

    candidate_name text,
    candidate_email text,
    candidate_phone text,

    upload_status text not null default 'uploaded'
        check (upload_status in ('uploaded', 'processing', 'ready', 'failed')),
    processing_error text,

    extracted_text text,
    extracted_text_char_count integer not null default 0,
    chunk_count integer not null default 0,

    uploaded_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
);

create index idx_cv_files_status on cv_files (upload_status);
create index idx_cv_files_uploaded_at on cv_files (uploaded_at desc);
create index idx_cv_files_candidate_email on cv_files (candidate_email);
```

Notes:

- `storage_path` points to the file in Supabase Storage.
- `deleted_at` enables soft delete if you want safer cleanup before removing vectors/files.
- `extracted_text` can stay here for quick preview support.

### 3.2 `cv_chunks`

One row per chunk created from a CV during ingestion.

```sql
create table cv_chunks (
    id uuid primary key default gen_random_uuid(),
    cv_file_id uuid not null references cv_files(id) on delete cascade,

    chunk_index integer not null,
    chunk_text text not null,
    token_count integer,
    char_count integer not null,

    pinecone_vector_id text not null unique,

    page_number integer,
    section_label text,

    created_at timestamptz not null default now(),

    constraint uq_cv_chunks_file_chunk unique (cv_file_id, chunk_index)
);

create index idx_cv_chunks_cv_file_id on cv_chunks (cv_file_id);
create index idx_cv_chunks_pinecone_vector_id on cv_chunks (pinecone_vector_id);
```

Notes:

- This table is important even though vectors live in Pinecone.
- It gives us stable citations and lets us inspect chunk text without asking Pinecone for everything.

### 3.3 `conversations`

One row per chat thread.

```sql
create table conversations (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    status text not null default 'active'
        check (status in ('active', 'archived')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_message_at timestamptz,
    deleted_at timestamptz
);

create index idx_conversations_created_at on conversations (created_at desc);
create index idx_conversations_last_message_at on conversations (last_message_at desc);
```

Notes:

- Since the requirements describe a shared knowledge base, this initial schema assumes no user accounts.
- If auth is added later, introduce `user_id` on this table.

### 3.4 `messages`

One row per user or assistant message.

```sql
create table messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references conversations(id) on delete cascade,

    role text not null check (role in ('user', 'assistant', 'system')),
    content text not null,

    model_name text,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,

    created_at timestamptz not null default now()
);

create index idx_messages_conversation_id_created_at
    on messages (conversation_id, created_at asc);
```

Notes:

- `system` is optional but useful if you want to persist generated system prompts or hidden orchestration context.
- Token columns help with debugging and cost tracking.

### 3.5 `conversation_message_citations`

Maps assistant answers back to the CV chunks they used.

```sql
create table conversation_message_citations (
    id uuid primary key default gen_random_uuid(),
    message_id uuid not null references messages(id) on delete cascade,
    cv_file_id uuid not null references cv_files(id) on delete cascade,
    cv_chunk_id uuid not null references cv_chunks(id) on delete cascade,

    citation_index integer not null,
    quoted_text text,
    relevance_score numeric(6,5),

    created_at timestamptz not null default now(),

    constraint uq_message_citation_order unique (message_id, citation_index)
);

create index idx_message_citations_message_id on conversation_message_citations (message_id);
create index idx_message_citations_cv_file_id on conversation_message_citations (cv_file_id);
```

Notes:

- This table powers frontend citations like "Based on John_Doe_CV.pdf".
- `quoted_text` is optional but helps when showing the exact supporting snippet.

## 4. Recommended Optional Tables

These are not mandatory for v1, but they are useful if you want cleaner operations.

### 4.1 `cv_processing_runs`

Tracks each ingestion attempt separately.

```sql
create table cv_processing_runs (
    id uuid primary key default gen_random_uuid(),
    cv_file_id uuid not null references cv_files(id) on delete cascade,

    status text not null
        check (status in ('queued', 'processing', 'completed', 'failed')),
    embedding_model text,
    chunking_strategy text,
    error_message text,

    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now()
);

create index idx_cv_processing_runs_cv_file_id on cv_processing_runs (cv_file_id);
```

Use this if you expect retries and want an audit trail.

### 4.2 `cv_skills`

Stores extracted skills for fast filtering in the UI.

```sql
create table cv_skills (
    id uuid primary key default gen_random_uuid(),
    cv_file_id uuid not null references cv_files(id) on delete cascade,
    skill_name text not null,
    normalized_skill_name text not null,
    created_at timestamptz not null default now(),

    constraint uq_cv_skill unique (cv_file_id, normalized_skill_name)
);

create index idx_cv_skills_normalized_skill_name on cv_skills (normalized_skill_name);
```

This is useful because the wireframe mentions skill tags on the CV list page.

## 5. Pinecone Vector Shape

Each `cv_chunks` row should have a matching Pinecone vector.

Suggested Pinecone record:

```json
{
  "id": "0f07c2d8-6a69-4cf0-a1a7-f4b7a4d7c1dd",
  "values": [0.123, 0.456, 0.789],
  "metadata": {
    "cv_file_id": "2ab8a22c-d73e-4780-a7ca-00adf6fc9f6e",
    "chunk_id": "0f07c2d8-6a69-4cf0-a1a7-f4b7a4d7c1dd",
    "chunk_index": 7,
    "original_filename": "john_doe_cv.pdf",
    "candidate_name": "John Doe",
    "page_number": 2,
    "section_label": "Experience",
    "text": "Led development of internal analytics tools using Python and SQL..."
  }
}
```

Recommended rule:

- set `pinecone_vector_id = cv_chunks.id`

That keeps Postgres and Pinecone aligned with one stable identifier.

## 6. Minimal V1 Schema

If you want the simplest version that still fully supports the requirements, start with:

- `cv_files`
- `cv_chunks`
- `conversations`
- `messages`
- `conversation_message_citations`

That is enough for:

- upload/list/delete CVs
- processing state
- chunk storage metadata
- persistent conversation history
- grounded answer citations

## 7. Suggested Backend Models

These map cleanly to SQLAlchemy models:

- `CVFile`
- `CVChunk`
- `Conversation`
- `Message`
- `MessageCitation`

## 8. Suggested Future Additions

Later, if the project grows, consider:

- `users` for authentication
- `tags` or `cv_labels`
- `conversation_retrieval_logs` for debugging RAG
- `message_feedback` for thumbs up/down on answers
- `cv_structured_profiles` for extracted education, experience, and summary fields

## 9. Implementation Notes

- Use `uuid` primary keys everywhere for easier frontend/backend coordination.
- Add an `updated_at` trigger in Postgres or handle timestamps in the backend.
- When deleting a CV:
  1. delete Pinecone vectors by `cv_file_id`
  2. delete the Supabase Storage file
  3. delete the `cv_files` row, which cascades to `cv_chunks` and citations
- When resetting a conversation:
  - delete rows from `messages` where `conversation_id = ?`
  - citations will cascade from deleted assistant messages

## 10. Recommendation

For this project, I recommend implementing the following exact relational schema first:

- `cv_files`
- `cv_chunks`
- `conversations`
- `messages`
- `conversation_message_citations`
- optional `cv_skills`

This gives you a schema that is simple enough for an intern project, but still strong enough to support:

- clean RAG ingestion
- persistent multi-chat history
- traceable citations
- future UI filtering and preview features
