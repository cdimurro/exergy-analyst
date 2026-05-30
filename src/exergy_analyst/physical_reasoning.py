"""General physical-quantity reasoning shared by the analysis pipeline.

This mirrors the workspace ``physical-reasoning`` core: a few domain-agnostic
facts about physical quantities so the engine reasons from principle rather than
per-case patches. A quantity has an admissible range; an intensive aggregate
must not be corrupted by one invalid contributor; two independent estimates of
the same value should be reconciled, not rationalized.
"""

from __future__ import annotations

from collections.abc import Iterable

ABSOLUTE_ZERO_C = -273.15


def is_physical(kind: str, value: float | None) -> bool:
    """Return whether a value is physically admissible for its kind."""

    if value is None:
        return False
    if kind == "absolute_temperature_c":
        return value > ABSOLUTE_ZERO_C
    if kind == "magnitude":
        return value >= 0.0
    if kind == "fraction":
        return 0.0 <= value <= 1.0
    if kind == "percent":
        return 0.0 <= value <= 100.0
    return True


def robust_weighted_mean(pairs: Iterable[tuple[float | None, float | None]]) -> float | None:
    """Weighted mean over (weight, value) pairs.

    Non-finite values and non-positive weights are ignored, so a single invalid
    contributor cannot corrupt an intensive aggregate. Returns ``None`` when no
    valid contributor remains.
    """

    weight_sum = 0.0
    weighted = 0.0
    for weight, value in pairs:
        if weight is None or value is None:
            continue
        if weight <= 0.0:
            continue
        weight_sum += weight
        weighted += weight * value
    return weighted / weight_sum if weight_sum > 0.0 else None


def reconcile(estimates: Iterable[float], tolerance: float = 2.0) -> tuple[bool, float]:
    """Reconcile independent estimates of one quantity.

    Returns ``(agree, spread)`` where ``spread`` is the ratio of the largest to
    the smallest positive estimate. Estimates that disagree by more than the
    multiplicative ``tolerance`` are a finding to surface, not to explain away.
    """

    valid = [value for value in estimates if value is not None and value > 0.0]
    if len(valid) < 2:
        return True, 1.0
    spread = max(valid) / min(valid)
    return spread <= tolerance, spread
