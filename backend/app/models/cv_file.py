import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class CVFile(Base):
    __tablename__ = "cv_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    original_filename: Mapped[str] = mapped_column(Text, nullable=False)
    storage_bucket: Mapped[str] = mapped_column(Text, nullable=False, default="cv-uploads")
    storage_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    candidate_name: Mapped[str | None] = mapped_column(Text)
    candidate_email: Mapped[str | None] = mapped_column(Text)
    candidate_phone: Mapped[str | None] = mapped_column(Text)
    upload_status: Mapped[str] = mapped_column(Text, nullable=False, default="uploaded")
    processing_error: Mapped[str | None] = mapped_column(Text)
    extracted_text: Mapped[str | None] = mapped_column(Text)
    extracted_text_char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    chunks: Mapped[list["CVChunk"]] = relationship(
        "CVChunk",
        back_populates="cv_file",
        cascade="all, delete-orphan",
    )
    citations: Mapped[list["MessageCitation"]] = relationship(
        "MessageCitation",
        back_populates="cv_file",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint("file_size_bytes > 0 AND file_size_bytes <= 10485760", name="ck_cv_files_size"),
        CheckConstraint(
            "upload_status IN ('uploaded', 'processing', 'ready', 'failed')",
            name="ck_cv_files_upload_status",
        ),
    )
