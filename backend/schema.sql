CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz,
    deleted_at timestamptz
);

CREATE INDEX idx_conversations_created_at ON conversations (created_at);
CREATE INDEX idx_conversations_last_message_at ON conversations (last_message_at);

CREATE TABLE cv_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    original_filename text NOT NULL,
    storage_bucket text NOT NULL DEFAULT 'cv-uploads',
    storage_path text NOT NULL UNIQUE,
    mime_type text NOT NULL,
    file_size_bytes bigint NOT NULL
        CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
    candidate_name text,
    candidate_email text,
    candidate_phone text,
    upload_status text NOT NULL DEFAULT 'uploaded'
        CHECK (upload_status IN ('uploaded', 'processing', 'ready', 'failed')),
    processing_error text,
    extracted_text text,
    extracted_text_char_count integer NOT NULL DEFAULT 0,
    chunk_count integer NOT NULL DEFAULT 0,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX idx_cv_files_candidate_email ON cv_files (candidate_email);
CREATE INDEX idx_cv_files_status ON cv_files (upload_status);
CREATE INDEX idx_cv_files_uploaded_at ON cv_files (uploaded_at);

CREATE TABLE cv_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cv_file_id uuid NOT NULL REFERENCES cv_files(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL,
    chunk_text text NOT NULL,
    token_count integer,
    char_count integer NOT NULL,
    pinecone_vector_id text NOT NULL UNIQUE,
    page_number integer,
    section_label text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_cv_chunks_file_chunk UNIQUE (cv_file_id, chunk_index)
);

CREATE INDEX idx_cv_chunks_cv_file_id ON cv_chunks (cv_file_id);
CREATE INDEX idx_cv_chunks_pinecone_vector_id ON cv_chunks (pinecone_vector_id);

CREATE TABLE messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content text NOT NULL,
    model_name text,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_id_created_at
    ON messages (conversation_id, created_at);

CREATE TABLE conversation_message_citations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    cv_file_id uuid NOT NULL REFERENCES cv_files(id) ON DELETE CASCADE,
    cv_chunk_id uuid NOT NULL REFERENCES cv_chunks(id) ON DELETE CASCADE,
    citation_index integer NOT NULL,
    quoted_text text,
    relevance_score numeric(6, 5),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_message_citation_order UNIQUE (message_id, citation_index)
);

CREATE INDEX idx_message_citations_cv_file_id
    ON conversation_message_citations (cv_file_id);
CREATE INDEX idx_message_citations_message_id
    ON conversation_message_citations (message_id);
