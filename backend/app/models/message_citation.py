import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class MessageCitation(Base):
    __tablename__ = "conversation_message_citations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    cv_file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cv_files.id", ondelete="CASCADE"),
        nullable=False,
    )
    cv_chunk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cv_chunks.id", ondelete="CASCADE"),
        nullable=False,
    )
    citation_index: Mapped[int] = mapped_column(nullable=False)
    quoted_text: Mapped[str | None] = mapped_column(Text)
    relevance_score: Mapped[float | None] = mapped_column(Numeric(6, 5))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    message: Mapped["Message"] = relationship("Message", back_populates="citations")
    cv_file: Mapped["CVFile"] = relationship("CVFile", back_populates="citations")
    cv_chunk: Mapped["CVChunk"] = relationship("CVChunk", back_populates="citations")

    __table_args__ = (
        UniqueConstraint("message_id", "citation_index", name="uq_message_citation_order"),
    )
