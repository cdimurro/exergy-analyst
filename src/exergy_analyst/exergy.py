"""Exergy calculations used by the first product workflows."""

from __future__ import annotations

import math


KELVIN_OFFSET = 273.15


def thermal_exergy_factor(source_temp_c: float, sink_temp_c: float) -> float:
    """Return Carnot thermal Exergy Factor for a constant-temperature source."""

    hot_k = source_temp_c + KELVIN_OFFSET
    sink_k = sink_temp_c + KELVIN_OFFSET
    if hot_k <= 0.0 or sink_k <= 0.0:
        raise ValueError("temperatures must be above absolute zero")
    if hot_k <= sink_k:
        return 0.0
    return max(0.0, min(1.0, 1.0 - sink_k / hot_k))


def accessible_exergy_mwh(energy_mwh: float, exergy_factor: float) -> float:
    """Return accessible useful-work potential in MWh_ex."""

    return energy_mwh * exergy_factor


def exergy_loss_angle(input_exergy: float, useful_output_exergy: float) -> float:
    """Return a bounded display angle for useful-work loss."""

    if input_exergy < 0.0 or useful_output_exergy < 0.0:
        raise ValueError("exergy values must be nonnegative")
    lost = max(0.0, input_exergy - useful_output_exergy)
    return math.degrees(math.atan2(lost, useful_output_exergy))

