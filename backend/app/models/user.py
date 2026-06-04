from sqlalchemy import Boolean, Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    reset_otp = Column(String, nullable=True)
    reset_otp_expires_at = Column(DateTime(timezone=True), nullable=True)
    is_admin = Column(Boolean, default=False, nullable=False, server_default="0")

    history = relationship("UserHistory", back_populates="user", cascade="all, delete-orphan")
    approved_srs = relationship("ApprovedSRS", back_populates="user", cascade="all, delete-orphan")
    plan = relationship("UserPlan", back_populates="user", uselist=False, cascade="all, delete-orphan")
    api_keys = relationship("UserApiKey", back_populates="user", cascade="all, delete-orphan")

class UserHistory(Base):
    __tablename__ = "user_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    action = Column(String, nullable=False)          # e.g. "SRS Generated"
    project_name = Column(String, nullable=True)     # project name from SRS
    provider = Column(String, nullable=True)         # gemini | ollama | openai
    sections_count = Column(Integer, nullable=True)  # number of SRS sections
    details = Column(Text, nullable=True)            # extra JSON metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="history")

class TemporarySRS(Base):
    __tablename__ = "temporary_srs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    session_id = Column(String, index=True, nullable=True)
    project_name = Column(String, nullable=True)
    content = Column(Text, nullable=False)  # JSON-serialized SRSGenerationResult
    team_content = Column(Text, nullable=True)  # JSON-serialized TeamDesign
    cost_content = Column(Text, nullable=True)  # JSON-serialized CostEstimation
    document_hash = Column(String, index=True, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    user = relationship("User")

class ApprovedSRS(Base):
    __tablename__ = "approved_srs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_name = Column(String, nullable=False)
    content = Column(Text, nullable=False)  # JSON-serialized approved SRS output
    team_content = Column(Text, nullable=True)  # JSON-serialized approved TeamDesign
    cost_content = Column(Text, nullable=True)  # JSON-serialized approved CostEstimation
    document_hash = Column(String, index=True, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="approved_srs")

class UploadedDocument(Base):
    __tablename__ = "uploaded_documents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    session_id = Column(String, index=True, nullable=True)
    filename = Column(String, nullable=False)
    content_text = Column(Text, nullable=False)
    hash = Column(String, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class UserPlan(Base):
    """Tracks the token budget and usage for each registered user."""
    __tablename__ = "user_plans"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    plan = Column(String, default="free", nullable=False)  # free | pro | byok
    token_budget_monthly = Column(Integer, default=50000, nullable=False)
    tokens_used_this_month = Column(Integer, default=0, nullable=False)
    window_start = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    user = relationship("User", back_populates="plan")


class UserApiKey(Base):
    """Stores per-user BYOK (Bring Your Own Key) API keys, AES-256 encrypted."""
    __tablename__ = "user_api_keys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider = Column(String, nullable=False)  # openai | gemini | ollama | anthropic
    encrypted_key = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())

    user = relationship("User", back_populates="api_keys")


class TokenUsageLog(Base):
    """Records every AI call with actual token counts for all 3 stages."""
    __tablename__ = "token_usage_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    session_id = Column(String, index=True, nullable=True)
    provider = Column(String, nullable=False)       # openai | gemini | ollama
    model = Column(String, nullable=True)
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    stage = Column(String, nullable=False)          # srs | team | cost
    project_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")

