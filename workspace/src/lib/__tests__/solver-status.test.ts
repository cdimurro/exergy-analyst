/**
 * CC-BE-GOV-0110 renderer unit tests.
 *
 * These lock the precedence rules documented at the top of
 * ``workspace/src/lib/solver-status.ts``:
 *
 *   1. blocked  (hard_fail OR promotion_blocked OR solver veto)
 *   2. mock     (forces screening/not-computed, never calibrated)
 *   3. solver-backed  (status === "ran" + confirmed concordance)
 *   4. screening      (status === "ran" + caveat / unknown gate)
 *   5. not computed   (every other status, incl. missing payload)
 */

import {
  renderMethodology,
  renderNoBackingCaveat,
  renderNotApplicableDetail,
  isBlocked,
  isMockBacked,
  isNotApplicable,
  isSolverBacked,
  allowsExergyValidatedLanguage,
  allowsPositiveReadinessLanguage,
  SOLVER_BACKED_STATUSES,
  SOLVER_FAILURE_STATUSES,
} from "@/lib/solver-status";

describe("renderMethodology precedence", () => {
  it("blocked: hard_fail wins over everything", () => {
    expect(renderMethodology({
      hard_fail: true,
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBe("blocked");
  });

  it("blocked: promotion_blocked wins even with solver ran", () => {
    expect(renderMethodology({
      promotion_blocked: true,
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBe("blocked");
  });

  it("blocked: solver_veto_reason wins", () => {
    expect(renderMethodology({
      solver_veto_reason: "Physics solver concordance=0.15 below veto threshold",
    })).toBe("blocked");
  });

  it("blocked: concordance_gate=veto wins", () => {
    expect(renderMethodology({
      physics_solver: { status: "ran", concordance_gate: "veto", concordance: 0.2 },
    })).toBe("blocked");
  });

  it("mock-backed + ran: downgrades to engineering estimate", () => {
    expect(renderMethodology({
      mock_sidecar: true,
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBe("engineering estimate");
  });

  it("mock-backed + non-ran: downgrades to not computed", () => {
    expect(renderMethodology({
      mock_sidecar: true,
      physics_solver: { status: "unavailable" },
    })).toBe("not computed");
  });

  it("solver-backed confirmed: calibrated simulation", () => {
    expect(renderMethodology({
      physics_solver: { status: "ran", concordance_gate: "confirmed", concordance: 0.85 },
    })).toBe("calibrated simulation");
  });

  it("solver-backed caveat: engineering estimate", () => {
    expect(renderMethodology({
      physics_solver: { status: "ran", concordance_gate: "caveat", concordance: 0.45 },
    })).toBe("engineering estimate");
  });

  it("solver-backed unknown gate: engineering estimate (does NOT inflate)", () => {
    // Guard against a "ran" status with a missing/unknown gate
    // silently inflating to calibrated.
    expect(renderMethodology({
      physics_solver: { status: "ran" },
    })).toBe("engineering estimate");
  });

  it.each([
    ["unavailable"],
    ["validation_failed"],
    ["dispatch_error"],
    ["not_registered"],
    ["not_run"],
    ["unknown_future_status"],
  ])("non-ran status %s renders as not computed", (status) => {
    expect(renderMethodology({
      physics_solver: { status },
    })).toBe("not computed");
  });

  it("missing physics_solver payload: not computed", () => {
    expect(renderMethodology({})).toBe("not computed");
    expect(renderMethodology({ physics_solver: null })).toBe("not computed");
    expect(renderMethodology({ physics_solver: {} })).toBe("not computed");
  });
});

describe("isBlocked / isSolverBacked / isMockBacked predicates", () => {
  it("isBlocked: every block signal flips it true", () => {
    expect(isBlocked({ hard_fail: true })).toBe(true);
    expect(isBlocked({ promotion_blocked: true })).toBe(true);
    expect(isBlocked({ solver_veto_reason: "x" })).toBe(true);
    expect(isBlocked({ physics_solver: { concordance_gate: "veto" } })).toBe(true);
    expect(isBlocked({})).toBe(false);
  });

  it("isSolverBacked: only ran + not blocked", () => {
    expect(isSolverBacked({
      physics_solver: { status: "ran" },
    })).toBe(true);
    // Blocked trumps solver_backed.
    expect(isSolverBacked({
      physics_solver: { status: "ran" },
      hard_fail: true,
    })).toBe(false);
    expect(isSolverBacked({
      physics_solver: { status: "unavailable" },
    })).toBe(false);
    expect(isSolverBacked({})).toBe(false);
  });

  it("isMockBacked: mock_sidecar=true only", () => {
    expect(isMockBacked({ mock_sidecar: true })).toBe(true);
    expect(isMockBacked({ mock_sidecar: false })).toBe(false);
    expect(isMockBacked({})).toBe(false);
  });
});

describe("allowsPositiveReadinessLanguage", () => {
  it("allows readiness language when no block signal fires", () => {
    expect(allowsPositiveReadinessLanguage({
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBe(true);
  });

  it("suppresses readiness language on hard_fail", () => {
    expect(allowsPositiveReadinessLanguage({
      hard_fail: true,
    })).toBe(false);
  });

  it("suppresses readiness language on promotion_blocked", () => {
    expect(allowsPositiveReadinessLanguage({
      promotion_blocked: true,
    })).toBe(false);
  });

  it("suppresses readiness language on solver veto", () => {
    expect(allowsPositiveReadinessLanguage({
      solver_veto_reason: "Physics solver concordance=0.15",
    })).toBe(false);
    expect(allowsPositiveReadinessLanguage({
      physics_solver: { concordance_gate: "veto" },
    })).toBe(false);
  });
});

describe("renderNoBackingCaveat", () => {
  it("returns null when the result is legitimately solver-backed", () => {
    expect(renderNoBackingCaveat({
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBeNull();
  });

  it("blocked runs get a blocked caveat with reason", () => {
    expect(renderNoBackingCaveat({
      solver_veto_reason: "Physics solver concordance=0.15",
    })).toMatch(/blocked/);
    expect(renderNoBackingCaveat({
      hard_fail: true,
    })).toMatch(/blocked/);
  });

  it("mock runs get a mock/demo caveat", () => {
    expect(renderNoBackingCaveat({
      mock_sidecar: true,
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toMatch(/mock\/demo/i);
  });

  it.each([
    ["unavailable"],
    ["validation_failed"],
    ["dispatch_error"],
  ])("failure status %s gets an explicit solver-status caveat", (status) => {
    const c = renderNoBackingCaveat({ physics_solver: { status } });
    expect(c).toMatch(/not solver-backed/i);
  });

  it("not_registered gets a registry-specific caveat", () => {
    const c = renderNoBackingCaveat({
      physics_solver: { status: "not_registered" },
    });
    expect(c).toMatch(/no family physics solver registered/i);
  });

  it("missing payload gets a terse not-computed caveat", () => {
    expect(renderNoBackingCaveat({})).toMatch(/not computed/i);
    expect(renderNoBackingCaveat({
      physics_solver: { status: "not_run" },
    })).toMatch(/not computed/i);
  });
});

describe("public constants", () => {
  it("SOLVER_BACKED_STATUSES contains only 'ran'", () => {
    expect(Array.from(SOLVER_BACKED_STATUSES)).toEqual(["ran"]);
  });

  it("SOLVER_FAILURE_STATUSES lists the three dispatch failure modes", () => {
    const arr = Array.from(SOLVER_FAILURE_STATUSES).sort();
    expect(arr).toEqual(["dispatch_error", "unavailable", "validation_failed"]);
  });
});

describe("Physics Evaluation Spine v0 status", () => {
  it("parametric_only renders as screening and is not solver-backed", () => {
    const input = {
      physics_evaluation: {
        verdict: "conditional",
        solver_status: "parametric_only",
        truth_tier: "parametric_screen",
        solver_artifacts: [],
        exergy_status: "unavailable",
      },
    };
    expect(renderMethodology(input)).toBe("engineering estimate");
    expect(isSolverBacked(input)).toBe(false);
    expect(allowsExergyValidatedLanguage(input)).toBe(false);
  });

  it("fake solver_backed without artifact cannot claim solver backing or exergy validation", () => {
    const input = {
      physics_evaluation: {
        verdict: "pass",
        solver_status: "solver_backed",
        truth_tier: "single_solver",
        solver_artifacts: [],
        exergy_status: "computed",
      },
    };
    expect(isSolverBacked(input)).toBe(false);
    expect(renderMethodology(input)).toBe("engineering estimate");
    expect(allowsExergyValidatedLanguage(input)).toBe(false);
  });

  it("solver_backed with artifact and concordance allows calibrated methodology", () => {
    const input = {
      physics_evaluation: {
        verdict: "pass",
        solver_status: "solver_backed",
        truth_tier: "reference_solver_concordance",
        solver_artifacts: [{ artifact_id: "run-1" }],
        exergy_status: "computed",
      },
    };
    expect(isSolverBacked(input)).toBe(true);
    expect(renderMethodology(input)).toBe("calibrated simulation");
    expect(allowsExergyValidatedLanguage(input)).toBe(true);
  });

  it("blocked missing-input spine result suppresses positive language", () => {
    const input = {
      physics_evaluation: {
        verdict: "blocked",
        solver_status: "parametric_only",
        truth_tier: "parametric_screen",
        hard_fail: false,
        solver_artifacts: [],
        exergy_status: "blocked",
      },
    };
    expect(isBlocked(input)).toBe(true);
    expect(renderMethodology(input)).toBe("blocked");
    expect(isSolverBacked(input)).toBe(false);
    expect(allowsPositiveReadinessLanguage(input)).toBe(false);
  });

  it("legacy hard_fail wins over pass-like spine status", () => {
    const input = {
      hard_fail: true,
      physics_evaluation: {
        verdict: "pass",
        solver_status: "solver_backed",
        truth_tier: "reference_solver_concordance",
        solver_artifacts: [{ artifact_id: "run-1" }],
        exergy_status: "computed",
      },
    };
    expect(isBlocked(input)).toBe(true);
    expect(renderMethodology(input)).toBe("blocked");
    expect(isSolverBacked(input)).toBe(false);
    expect(allowsPositiveReadinessLanguage(input)).toBe(false);
    expect(allowsExergyValidatedLanguage(input)).toBe(false);
  });

  it("legacy promotion_blocked wins over pass-like spine status", () => {
    const input = {
      promotion_blocked: true,
      physics_evaluation: {
        verdict: "pass",
        solver_status: "solver_backed",
        truth_tier: "reference_solver_concordance",
        solver_artifacts: [{ artifact_id: "run-1" }],
        exergy_status: "computed",
      },
    };
    expect(isBlocked(input)).toBe(true);
    expect(renderMethodology(input)).toBe("blocked");
    expect(isSolverBacked(input)).toBe(false);
    expect(allowsPositiveReadinessLanguage(input)).toBe(false);
  });
});

// ── CC-BE-0112: capability-mismatch refusal rendering ───────────────────────

describe("CC-BE-0112 not_applicable precedence", () => {
  const helium_refused = {
    physics_solver: {
      status: "not_applicable",
      solver_veto_reason:
        "capability_mismatch: coolant_type='helium' not in [h2o, light_water, water]",
      veto_detail: {
        axis: "coolant_type",
        observed: "helium",
        allowed: ["h2o", "light_water", "water"],
      },
    },
  };

  it("isNotApplicable: true when physics_solver.status === not_applicable", () => {
    expect(isNotApplicable(helium_refused)).toBe(true);
  });

  it("isNotApplicable: false otherwise", () => {
    expect(isNotApplicable({})).toBe(false);
    expect(isNotApplicable({ physics_solver: { status: "ran" } })).toBe(false);
    expect(isNotApplicable({ physics_solver: { status: "unavailable" } })).toBe(false);
  });

  it("renderMethodology: returns 'not applicable to this technology family'", () => {
    expect(renderMethodology(helium_refused)).toBe(
      "not applicable to this technology family",
    );
  });

  it("renderMethodology: not_applicable wins over would-be blocked signals", () => {
    // solver_veto_reason at top level would normally trigger 'blocked',
    // but not_applicable is semantically different and takes precedence.
    expect(renderMethodology({
      ...helium_refused,
      solver_veto_reason: "capability_mismatch: coolant_type=helium",
    })).toBe("not applicable to this technology family");
  });

  it("renderMethodology: hard_fail wins over not_applicable", () => {
    expect(renderMethodology({
      ...helium_refused,
      hard_fail: true,
    })).toBe("blocked");
  });

  it("renderNoBackingCaveat: hard_fail wins over not_applicable", () => {
    const caveat = renderNoBackingCaveat({
      ...helium_refused,
      hard_fail: true,
    });
    expect(caveat).toMatch(/result is blocked/i);
    expect(caveat).toMatch(/hard_fail/i);
  });

  it("isBlocked: false for not_applicable (scope mismatch ≠ hard failure)", () => {
    expect(isBlocked(helium_refused)).toBe(false);
    // Even with solver_veto_reason mirrored to top level, not_applicable
    // wins and isBlocked returns false.
    expect(isBlocked({
      ...helium_refused,
      solver_veto_reason: "capability_mismatch: coolant_type=helium",
    })).toBe(false);
  });

  it("isSolverBacked: false for not_applicable", () => {
    expect(isSolverBacked(helium_refused)).toBe(false);
  });

  it("allowsPositiveReadinessLanguage: false for not_applicable", () => {
    expect(allowsPositiveReadinessLanguage(helium_refused)).toBe(false);
  });

  it("renderNoBackingCaveat: specific 'not applicable to this technology family' message with reason", () => {
    const caveat = renderNoBackingCaveat(helium_refused);
    expect(caveat).toMatch(/not applicable to this technology family/i);
    expect(caveat).toMatch(/helium/);  // specific axis value
    expect(caveat).toMatch(/no solver backing/i);
    // Must NOT say "blocked" — the user deserves the specific category.
    expect(caveat).not.toMatch(/\bblocked\b/i);
  });

  it("renderNoBackingCaveat: includes generic fallback when veto_reason missing", () => {
    const caveat = renderNoBackingCaveat({
      physics_solver: { status: "not_applicable" },
    });
    expect(caveat).toMatch(/not applicable to this technology family/i);
    expect(caveat).toMatch(/no applicable solver/i);
  });

  it("renderNotApplicableDetail: exposes structured mismatch parts", () => {
    const detail = renderNotApplicableDetail(helium_refused);
    expect(detail).not.toBeNull();
    expect(detail!.axis).toBe("coolant_type");
    expect(detail!.observed).toBe("helium");
    expect(detail!.allowed).toEqual(["h2o", "light_water", "water"]);
    expect(detail!.reason).toMatch(/capability_mismatch/);
  });

  it("renderNotApplicableDetail: returns null for non-not-applicable states", () => {
    expect(renderNotApplicableDetail({})).toBeNull();
    expect(renderNotApplicableDetail({
      physics_solver: { status: "ran" },
    })).toBeNull();
    expect(renderNotApplicableDetail({ hard_fail: true })).toBeNull();
  });

  it("water-candidate run path unaffected by new precedence rule", () => {
    // Regression: ordinary LWR candidates must still render as
    // 'calibrated simulation' on confirmed concordance. The new rule
    // only fires when status === 'not_applicable'.
    expect(renderMethodology({
      physics_solver: { status: "ran", concordance_gate: "confirmed" },
    })).toBe("calibrated simulation");
  });
});
