"""SQLAlchemy ORM models for VentureForge."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all ORM models."""

    type_annotation_map = {
        dict[str, Any]: JSON,
        list[dict[str, Any]]: JSON,
        list[str]: JSON,
    }


class RunStatus(enum.StrEnum):
    """Run lifecycle states."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class PhaseStatus(enum.StrEnum):
    """Phase lifecycle states."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class OpportunityStatus(enum.StrEnum):
    """Opportunity screening status."""

    CANDIDATE = "candidate"
    SHORTLISTED = "shortlisted"
    SELECTED = "selected"
    ELIMINATED = "eliminated"


def _uuid() -> str:
    return str(uuid.uuid4())


class Run(Base):
    """Top-level record for a screener or builder execution."""

    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "screener" | "builder"
    status: Mapped[RunStatus] = mapped_column(
        Enum(RunStatus), default=RunStatus.PENDING, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    input_config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    current_phase: Mapped[str | None] = mapped_column(String(100), nullable=True)
    current_round: Mapped[int] = mapped_column(Integer, default=0)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    phases: Mapped[list[Phase]] = relationship("Phase", back_populates="run", cascade="all, delete")
    opportunities: Mapped[list[Opportunity]] = relationship(
        "Opportunity", back_populates="run", cascade="all, delete"
    )
    blueprint_sections: Mapped[list[BlueprintSection]] = relationship(
        "BlueprintSection", back_populates="run", cascade="all, delete"
    )


class Phase(Base):
    """A phase within a run (e.g., horizon_scan, deep_dive, problem_statement)."""

    __tablename__ = "phases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), nullable=False)
    phase_name: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[PhaseStatus] = mapped_column(
        Enum(PhaseStatus), default=PhaseStatus.PENDING, nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    round_count: Mapped[int] = mapped_column(Integer, default=0)
    final_output: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    run: Mapped[Run] = relationship("Run", back_populates="phases")
    rounds: Mapped[list[Round]] = relationship(
        "Round", back_populates="phase", cascade="all, delete"
    )


class Round(Base):
    """A single deliberation round within a phase."""

    __tablename__ = "rounds"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    phase_id: Mapped[str] = mapped_column(String(36), ForeignKey("phases.id"), nullable=False)
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    agent_outputs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    research_citations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    scores: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    critique_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    decision_rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_usage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    phase: Mapped[Phase] = relationship("Phase", back_populates="rounds")


class Opportunity(Base):
    """A candidate business opportunity from the screener."""

    __tablename__ = "opportunities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    phase_introduced: Mapped[str] = mapped_column(String(100), nullable=False)
    problem_space: Mapped[str] = mapped_column(Text, nullable=False)
    target_customer: Mapped[str] = mapped_column(Text, default="")
    ai_moat_description: Mapped[str] = mapped_column(Text, default="")
    scores: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    composite_score: Mapped[float] = mapped_column(Float, default=0.0)
    research_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[OpportunityStatus] = mapped_column(
        Enum(OpportunityStatus), default=OpportunityStatus.CANDIDATE
    )
    elimination_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    opportunity_thesis: Mapped[str | None] = mapped_column(Text, nullable=True)

    run: Mapped[Run] = relationship("Run", back_populates="opportunities")


class BlueprintSection(Base):
    """A section of the business blueprint from the builder."""

    __tablename__ = "blueprint_sections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), nullable=False)
    section_name: Mapped[str] = mapped_column(String(100), nullable=False)
    section_order: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    plain_text: Mapped[str] = mapped_column(Text, default="")
    quality_score: Mapped[float] = mapped_column(Float, default=0.0)
    revision_count: Mapped[int] = mapped_column(Integer, default=0)
    vc_critique: Mapped[str] = mapped_column(Text, default="")
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)

    run: Mapped[Run] = relationship("Run", back_populates="blueprint_sections")


class PromptVersion(Base):
    """Versioned prompt records for the prompt registry."""

    __tablename__ = "prompt_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    prompt_key: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    performance_metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_from_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | pending | retired
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Lesson(Base):
    """Accumulated lessons from meta-agent retrospectives."""

    __tablename__ = "lessons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source_run_id: Mapped[str] = mapped_column(String(36), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    insight: Mapped[str] = mapped_column(Text, nullable=False)
    applies_to: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class StateTransitionLog(Base):
    """Audit log for all run state transitions."""

    __tablename__ = "state_transition_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), nullable=False)
    from_status: Mapped[str] = mapped_column(String(20), nullable=False)
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
