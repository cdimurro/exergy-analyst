from exergy_analyst.physical_reasoning import (
    is_physical,
    reconcile,
    robust_weighted_mean,
)


def test_is_physical_domains():
    assert is_physical("absolute_temperature_c", 25)
    assert not is_physical("absolute_temperature_c", -300)
    assert is_physical("magnitude", 0)
    assert not is_physical("magnitude", -1)
    assert is_physical("fraction", 0.5)
    assert not is_physical("fraction", 1.4)
    assert not is_physical("magnitude", None)


def test_robust_weighted_mean_ignores_invalid_contributors():
    # A negative weight must not corrupt the weighted mean.
    value = robust_weighted_mean([(1000, 0.5), (-500, 0.99), (None, 0.1)])
    assert value == 0.5
    assert robust_weighted_mean([]) is None
    assert robust_weighted_mean([(-1, 0.5)]) is None


def test_reconcile_flags_large_spread():
    agree, spread = reconcile([100, 105])
    assert agree and spread < 1.1
    disagree, spread = reconcile([100, 2000])
    assert not disagree and spread == 20
    # Fewer than two valid estimates cannot disagree.
    assert reconcile([100]) == (True, 1.0)
