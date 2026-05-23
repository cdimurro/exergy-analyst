"""Claim-support helpers for client-facing analysis."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ClaimSupport(str, Enum):
    """How strongly a statement is supported by the uploaded data."""

    COMPUTED = "computed"
    OBSERVED = "observed"
    INFERRED = "inferred"
    BLOCKED = "blocked"


@dataclass(frozen=True)
class EvidenceItem:
    """A traceable piece of support for a claim."""

    support: ClaimSupport
    statement: str
    source: str


def computed(statement: str, source: str) -> EvidenceItem:
    return EvidenceItem(ClaimSupport.COMPUTED, statement, source)


def observed(statement: str, source: str) -> EvidenceItem:
    return EvidenceItem(ClaimSupport.OBSERVED, statement, source)


def inferred(statement: str, source: str) -> EvidenceItem:
    return EvidenceItem(ClaimSupport.INFERRED, statement, source)


def blocked(statement: str, source: str) -> EvidenceItem:
    return EvidenceItem(ClaimSupport.BLOCKED, statement, source)
