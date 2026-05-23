from exergy_analyst.exergy import accessible_exergy_mwh, thermal_exergy_factor


def test_thermal_exergy_factor_for_80c_heat_to_20c_sink():
    fx = thermal_exergy_factor(80.0, 20.0)
    assert round(fx, 3) == 0.170


def test_accessible_exergy_mwh_multiplies_energy_by_factor():
    assert accessible_exergy_mwh(10.0, 0.25) == 2.5


def test_thermal_exergy_factor_is_zero_when_source_is_not_hotter():
    assert thermal_exergy_factor(20.0, 20.0) == 0.0

