"""create initial tables

Revision ID: 20260520_000001
Revises:
Create Date: 2026-05-20 00:00:01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260520_000001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')

    op.create_table(
        "conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('active', 'archived')", name="ck_conversations_status"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_conversations_created_at", "conversations", ["created_at"], unique=False)
    op.create_index("idx_conversations_last_message_at", "conversations", ["last_message_at"], unique=False)

    op.create_table(
        "cv_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("original_filename", sa.Text(), nullable=False),
        sa.Column("storage_bucket", sa.Text(), nullable=False, server_default="cv-uploads"),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.Text(), nullable=False),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("candidate_name", sa.Text(), nullable=True),
        sa.Column("candidate_email", sa.Text(), nullable=True),
        sa.Column("candidate_phone", sa.Text(), nullable=True),
        sa.Column("upload_status", sa.Text(), nullable=False, server_default="uploaded"),
        sa.Column("processing_error", sa.Text(), nullable=True),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("extracted_text_char_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunk_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("file_size_bytes > 0 AND file_size_bytes <= 10485760", name="ck_cv_files_size"),
        sa.CheckConstraint(
            "upload_status IN ('uploaded', 'processing', 'ready', 'failed')",
            name="ck_cv_files_upload_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_path"),
    )
    op.create_index("idx_cv_files_candidate_email", "cv_files", ["candidate_email"], unique=False)
    op.create_index("idx_cv_files_status", "cv_files", ["upload_status"], unique=False)
    op.create_index("idx_cv_files_uploaded_at", "cv_files", ["uploaded_at"], unique=False)

    op.create_table(
        "cv_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("cv_file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column("pinecone_vector_id", sa.Text(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("section_label", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["cv_file_id"], ["cv_files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pinecone_vector_id"),
        sa.UniqueConstraint("cv_file_id", "chunk_index", name="uq_cv_chunks_file_chunk"),
    )
    op.create_index("idx_cv_chunks_cv_file_id", "cv_chunks", ["cv_file_id"], unique=False)
    op.create_index("idx_cv_chunks_pinecone_vector_id", "cv_chunks", ["pinecone_vector_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("model_name", sa.Text(), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant', 'system')", name="ck_messages_role"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_messages_conversation_id_created_at",
        "messages",
        ["conversation_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "conversation_message_citations",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cv_file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cv_chunk_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("citation_index", sa.Integer(), nullable=False),
        sa.Column("quoted_text", sa.Text(), nullable=True),
        sa.Column("relevance_score", sa.Numeric(6, 5), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["cv_chunk_id"], ["cv_chunks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cv_file_id"], ["cv_files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "citation_index", name="uq_message_citation_order"),
    )
    op.create_index("idx_message_citations_cv_file_id", "conversation_message_citations", ["cv_file_id"], unique=False)
    op.create_index("idx_message_citations_message_id", "conversation_message_citations", ["message_id"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_message_citations_message_id", table_name="conversation_message_citations")
    op.drop_index("idx_message_citations_cv_file_id", table_name="conversation_message_citations")
    op.drop_table("conversation_message_citations")

    op.drop_index("idx_messages_conversation_id_created_at", table_name="messages")
    op.drop_table("messages")

    op.drop_index("idx_cv_chunks_pinecone_vector_id", table_name="cv_chunks")
    op.drop_index("idx_cv_chunks_cv_file_id", table_name="cv_chunks")
    op.drop_table("cv_chunks")

    op.drop_index("idx_cv_files_uploaded_at", table_name="cv_files")
    op.drop_index("idx_cv_files_status", table_name="cv_files")
    op.drop_index("idx_cv_files_candidate_email", table_name="cv_files")
    op.drop_table("cv_files")

    op.drop_index("idx_conversations_last_message_at", table_name="conversations")
    op.drop_index("idx_conversations_created_at", table_name="conversations")
    op.drop_table("conversations")
