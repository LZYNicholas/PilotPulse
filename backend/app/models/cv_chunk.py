import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class CVChunk(Base):
    __tablename__ = "cv_chunks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cv_file_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cv_files.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int | None] = mapped_column(Integer)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False)
    pinecone_vector_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    page_number: Mapped[int | None] = mapped_column(Integer)
    section_label: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    cv_file: Mapped["CVFile"] = relationship("CVFile", back_populates="chunks")
    citations: Mapped[list["MessageCitation"]] = relationship(
        "MessageCitation",
        back_populates="cv_chunk",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("cv_file_id", "chunk_index", name="uq_cv_chunks_file_chunk"),
    )
