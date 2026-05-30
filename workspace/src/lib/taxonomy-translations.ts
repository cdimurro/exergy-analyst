/**
 * Workspace UI taxonomy translations (CC-BE-SCHEMA-0007).
 *
 * Single source of truth for converting backend taxonomic labels
 * (calibration tiers, IRIS grades, verdicts, confidence floats,
 * uncertainty tiers, hard-fail reasons) into plain-language,
 * domain-specific explanations.
 *
 * Per feedback_user_facing_taxonomy_translation.md: users (founders,
 * investors, scientists, researchers, engineers, project developers)
 * should NEVER see raw labels like "C0-schema" or "IRIS-3" or
 * "U2 uncertainty". They see what the label MEANS in the context of
 * their specific technology, plus what would change the assessment.
 *
 * Backend artifacts (JSON) keep raw labels for programmatic consumers.
 * The CLI keeps raw labels for operator tools. The boundary is the
 * workspace UI — every component that renders brief / evaluation data
 * routes through these translators.
 */

// ---------------------------------------------------------------------------
// Domain → human-readable label (used to make explanations specific)
// ---------------------------------------------------------------------------

const DOMAIN_LABELS: Record<string, string> = {
  pv: "solar PV module",
  photovoltaic: "solar PV module",
  battery: "battery cell",
  electrochemical_storage: "battery / electrochemical storage",
  inverter: "inverter / power electronics",
  inverter_dc_ac: "DC-AC inverter",
  power_electronics: "inverter / power electronics",
  heat_pump_systems: "heat pump",
  heat_pump_hvac: "HVAC heat pump",
  electrolysis_conversion: "electrolyzer",
  h2_pem_electrolysis: "PEM electrolyzer",
  hydrogen_electrolysis: "electrolyzer",
  carbon_capture_systems: "carbon capture system",
  carbon_capture: "carbon capture system",
  fuel_cell_systems: "fuel cell",
  small_modular_nuclear: "small modular reactor",
  nuclear_fission: "nuclear reactor",
  nuclear_fusion: "fusion reactor",
  wind_turbine_systems: "wind turbine",
  offshore_wind_floating: "floating offshore wind turbine",
  small_wind: "small wind turbine",
  geothermal: "geothermal system",
  advanced_geothermal_egs: "enhanced geothermal system",
  flow_battery: "flow battery",
  thermal_storage: "thermal storage system",
  ptl_soec_ft: "Power-to-Liquid SOEC + FT synthesis system",
  ptl_rwgs_ft: "Power-to-Liquid RWGS + FT synthesis system",
  waste_to_fuels: "waste-to-fuels system",
  waste_to_energy: "waste-to-energy plant",
  // Fallback handled at function level
};

function domainLabel(domain: string | undefined): string {
  if (!domain) return "this technology";
  const explicit = DOMAIN_LABELS[domain.toLowerCase()];
  if (explicit) return explicit;
  // Generic fallback: humanize the kernel_id
  return domain.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Calibration tier (the most user-facing label)
// ---------------------------------------------------------------------------

export type CalibrationIntent = "low" | "moderate" | "high" | "very_high";

export interface CalibrationContext {
  /** Raw backend tier string (e.g. "C0-schema", "C1-provisional"). */
  tier: string;
  /** How many curated reference devices anchor this evaluation. */
  peerCount?: number;
  /** Domain key to make the explanation technology-specific. */
  domain?: string;
  /** Family label (already translated, e.g. "cold-climate ASHP"). */
  familyLabel?: string;
  /** Nearest peer's commercial name when one exists. */
  nearestPeerName?: string;
  /** Backend-supplied upgrade hint (already actionable prose). */
  upgradeGuidance?: string;
}

export interface CalibrationExplanation {
  /** Short ≤80-char headline for cards / badges. */
  headline: string;
  /** 1–3 sentence prose explanation of what the tier means
   *  for THIS technology. */
  explanation: string;
  /** Concrete upgrade path the user (or the platform) can take. */
  upgradePath?: string;
  /** Short visual badge label — never shows raw "C0" / "C1". */
  badgeLabel: string;
  /** Visual intent for color/severity coding. */
  intent: CalibrationIntent;
}

/**
 * Convert a backend calibration tier into user-facing prose.
 *
 * Honest about confidence + what we were/weren't able to do, but
 * NEVER leaks platform mechanics:
 *   - never names internal artifacts ("reference device", "kernel
 *     priors", "fixture", "physics solver", "concordance")
 *   - never gives platform-team instructions ("add a curated
 *     reference device") — upgrade guidance is user-actionable only
 *   - never exposes raw tier tokens (C0/C1/C2/IRIS-N)
 */
export function explainCalibrationTier(
  ctx: CalibrationContext,
): CalibrationExplanation {
  const dom = domainLabel(ctx.domain);
  const fam = ctx.familyLabel || `this category of ${dom}`;
  const peerCount = ctx.peerCount ?? 0;
  const peerName = ctx.nearestPeerName;
  const tier = (ctx.tier || "").toLowerCase();

  // Generic upgrade guidance — what the USER can do to tighten the
  // assessment. Never names internal data structures.
  const userActionableUpgrade =
    `Uploading operating performance data, third-party test reports, ` +
    `or independent certifications would tighten this analysis.`;

  if (tier.startsWith("c0")) {
    return {
      headline: `General-category assessment for ${fam}`,
      explanation:
        `Your candidate was assessed against general performance and ` +
        `economic ranges for ${dom}. We weren't able to compare it ` +
        `against specific ${fam} products, so treat the result as a ` +
        `directional first read — useful for spotting non-starters, ` +
        `not sufficient for deployment commitments.`,
      upgradePath: userActionableUpgrade,
      badgeLabel: "Directional",
      intent: "low",
    };
  }

  if (tier.startsWith("c1")) {
    const benchmarkedAgainst = peerName
      ? `against ${peerName}`
      : peerCount === 1
        ? `against one similar ${fam} product`
        : `against ${peerCount} similar ${fam} products`;
    return {
      headline: `Compared ${benchmarkedAgainst}`,
      explanation:
        `We benchmarked your candidate ${benchmarkedAgainst}` +
        `${peerCount > 1 && peerName ? ` and ${peerCount - 1} other` +
          ` similar product${peerCount - 1 === 1 ? "" : "s"}` : ""}. ` +
        `Confidence is moderate — strong enough for technical due ` +
        `diligence, but we recommend validating critical performance ` +
        `claims against your own operational data before capital ` +
        `decisions.`,
      upgradePath: userActionableUpgrade,
      badgeLabel: "Provisional",
      intent: "moderate",
    };
  }

  if (tier.startsWith("c2")) {
    return {
      headline: `Benchmarked against well-documented ${fam} products`,
      explanation:
        `This assessment is anchored to ${fam} products with verified ` +
        `operating histories${peerName ? ` (closest match: ${peerName})` : ""}. ` +
        `Confidence is suitable for technical due diligence and ` +
        `early investment review.`,
      badgeLabel: "Benchmarked",
      intent: "high",
    };
  }

  if (tier.startsWith("c3")) {
    return {
      headline: `Physics-validated for ${dom}`,
      explanation:
        `This assessment combines product comparisons with ` +
        `first-principles physics modelling for ${dom}. Confidence is ` +
        `suitable for engineering decisions.`,
      badgeLabel: "Engineering-grade",
      intent: "high",
    };
  }

  if (tier.startsWith("c4")) {
    return {
      headline: `Validated across multiple operating conditions`,
      explanation:
        `This ${dom} assessment is backed by independent comparisons ` +
        `spanning different operating conditions. Confidence is ` +
        `suitable for engineering and procurement decisions.`,
      badgeLabel: "Field-validated",
      intent: "very_high",
    };
  }

  if (tier.startsWith("c5")) {
    return {
      headline: `Validated against commercial deployment data`,
      explanation:
        `This ${dom} assessment is anchored to real commercial-scale ` +
        `operating data. Confidence is suitable for capital-committing ` +
        `decisions.`,
      badgeLabel: "Deployment-validated",
      intent: "very_high",
    };
  }

  // Unknown tier — safe fallback
  return {
    headline: "Confidence not classified",
    explanation:
      `We were not able to classify the confidence level of this ` +
      `${dom} assessment. Treat the result as directional only.`,
    badgeLabel: "Unclassified",
    intent: "low",
  };
}

// ---------------------------------------------------------------------------
// Module verdict (per-module pass / conditional / fail / blocked)
// ---------------------------------------------------------------------------

export interface ModuleVerdictExplanation {
  /** ≤60-char user-facing label. */
  label: string;
  /** Short prose for the verdict. */
  explanation: string;
  /** Visual intent. */
  intent: "good" | "neutral" | "concern" | "blocker";
}

export function explainModuleVerdict(
  verdict: string,
  opts: {
    moduleLabel?: string;
    keyDetail?: string;
    domain?: string;
  } = {},
): ModuleVerdictExplanation {
  const v = (verdict || "").toLowerCase();
  const mod = opts.moduleLabel || "This dimension";
  const detail = opts.keyDetail ? ` ${opts.keyDetail}` : "";

  if (v === "pass") {
    return {
      label: "Strong",
      explanation: `${mod} meets the deployment-readiness criteria.${detail}`,
      intent: "good",
    };
  }
  if (v === "conditional") {
    return {
      label: "Conditional",
      explanation:
        `${mod} is acceptable but with caveats — review the ` +
        `specific limitations before relying on this dimension.${detail}`,
      intent: "neutral",
    };
  }
  if (v === "fail") {
    return {
      label: "Not ready",
      explanation:
        `${mod} fails one or more deployment-readiness criteria. ` +
        `This is a blocker for production deployment.${detail}`,
      intent: "concern",
    };
  }
  if (v === "blocked") {
    return {
      label: "Insufficient data",
      explanation:
        `${mod} cannot be evaluated yet — additional information ` +
        `is required.${detail}`,
      intent: "blocker",
    };
  }
  if (v === "deferred" || v === "not_evaluated") {
    return {
      label: "Not applicable yet",
      explanation:
        `${mod} is not applicable at the candidate's current stage.`,
      intent: "neutral",
    };
  }
  return {
    label: "Unclear",
    explanation: `${mod} verdict is unclear.`,
    intent: "neutral",
  };
}

// ---------------------------------------------------------------------------
// Confidence (0..1 float → user-facing band)
// ---------------------------------------------------------------------------

export interface ConfidenceExplanation {
  /** Short label e.g. "High confidence" or "Confidence not measured". */
  label: string;
  /** Prose explanation referenced to the underlying calibration. */
  explanation: string;
  /** 0–100 displayed value. NULL when confidence was not measured —
   *  the caller should render "—" rather than "0%" to avoid the
   *  silent default of treating "missing" as "zero confidence". */
  displayPct: number | null;
  /** Visual intent. "low" used for both unmeasured AND truly-low. */
  intent: "low" | "moderate" | "high";
}

export function explainConfidence(
  confidence: number | null | undefined,
  opts: { domain?: string; tier?: string } = {},
): ConfidenceExplanation {
  const dom = domainLabel(opts.domain);
  // Distinguish "not measured" (null/undefined/NaN) from "measured at 0".
  // Without this guard the UI would show "0%" for missing confidence,
  // which the user reads as "we measured zero confidence" — a much
  // stronger claim than "we don't have a measurement to share".
  const isMeasured =
    typeof confidence === "number" && isFinite(confidence);
  if (!isMeasured) {
    return {
      label: "Confidence not measured",
      explanation:
        `No confidence measurement is available for this ${dom} ` +
        `assessment. Treat the result as directional only until ` +
        `evidence is wired into the modules.`,
      displayPct: null,
      intent: "low",
    };
  }
  const c = Math.max(0, Math.min(1, confidence as number));
  const pct = Math.round(c * 100);
  if (c >= 0.7) {
    return {
      label: "High confidence",
      explanation:
        `Multiple independent lines of evidence agree for this ${dom} ` +
        `assessment.`,
      displayPct: pct,
      intent: "high",
    };
  }
  if (c >= 0.4) {
    return {
      label: "Moderate confidence",
      explanation:
        `Some independent evidence supports this ${dom} assessment, ` +
        `but key data points are missing or carry uncertainty.`,
      displayPct: pct,
      intent: "moderate",
    };
  }
  return {
    label: "Low confidence",
    explanation:
      `Limited evidence available for this ${dom} assessment. ` +
      `Treat the result as directional only.`,
    displayPct: pct,
    intent: "low",
  };
}

// ---------------------------------------------------------------------------
// Hard-fail reasons → human-readable headline
// ---------------------------------------------------------------------------

export interface HardFailExplanation {
  /** Short headline for the most severe blocker. */
  headline: string;
  /** Full prose pulling all reasons into a single explanation. */
  explanation: string;
}

export function explainHardFail(
  reasons: string[],
  opts: { domain?: string } = {},
): HardFailExplanation | null {
  if (!reasons || reasons.length === 0) return null;
  const dom = domainLabel(opts.domain);
  const head = reasons[0]
    .replace(/^[a-z_]+:\s*/, "") // strip "module: " prefix
    .replace(/\s+/g, " ")
    .trim();
  const body =
    reasons.length === 1
      ? `One blocker prevents deployment readiness: ${head}.`
      : `${reasons.length} blockers prevent deployment readiness for ` +
        `this ${dom}. The most severe: ${head}.`;
  return {
    headline: head.length > 80 ? head.slice(0, 77) + "…" : head,
    explanation: body,
  };
}

// ---------------------------------------------------------------------------
// Peer-match summary — distinct from calibration tier; tells the user
// WHICH curated device(s) anchored the assessment.
// ---------------------------------------------------------------------------

export interface PeerMatchExplanation {
  /** Short ≤80-char summary. */
  headline: string;
  /** Prose with the nearest peer + distance qualifier. */
  explanation: string;
}

export function explainPeerMatch(
  peerMatching: {
    peer_count?: number;
    nearest_peer?: {
      commercial_name?: string;
      device_id?: string;
      overall_distance_pct?: number | null;
      n_matched_kpis?: number;
    } | null;
    upgrade_guidance?: string | null;
  } | null | undefined,
  opts: { domain?: string; familyLabel?: string } = {},
): PeerMatchExplanation | null {
  if (!peerMatching) return null;
  const dom = domainLabel(opts.domain);
  const fam = opts.familyLabel || "this technology family";
  const count = peerMatching.peer_count ?? 0;
  const nearest = peerMatching.nearest_peer;

  if (count === 0 || !nearest) {
    return {
      headline: `No specific ${fam} comparison available`,
      explanation:
        `The assessment uses general ${dom} performance ranges. ` +
        `We weren't able to compare your candidate against specific ` +
        `${fam} products in a product-by-product way.`,
    };
  }

  const peerName = nearest.commercial_name || nearest.device_id || "a similar product";
  const dist = nearest.overall_distance_pct;
  const matched = nearest.n_matched_kpis ?? 0;

  // Treat null/undefined/NaN/Infinity as "no numeric distance available"
  // — backend should never emit non-finite, but defensive guard
  // prevents "Infinity% deviation" leaking into prose.
  if (dist === null || dist === undefined || !Number.isFinite(dist)) {
    return {
      headline: `Compared against ${peerName}`,
      explanation:
        `The closest similar ${fam} product is ${peerName}. ` +
        `Not enough comparable specifications were available to ` +
        `compute a numeric similarity score, but the comparison ` +
        `still anchors the assessment to a real product.`,
    };
  }

  // Use absolute distance for qualifier — negative deltas represent
  // "candidate below peer" but the proximity-band semantics depend on
  // magnitude, not direction. Backend filters extreme deltas (>500%)
  // out of overall_distance_pct, but a defensive cap here protects the
  // renderer if a malformed peer slips through.
  const absDist = Math.abs(dist);
  if (absDist > 200) {
    // Likely unit mismatch or data error; tell the user, don't hide it.
    return {
      headline: `Comparison to ${peerName} looks unreliable`,
      explanation:
        `The specifications we compared (across ${matched} parameter` +
        `${matched === 1 ? "" : "s"}) differ by more than ${Math.round(absDist)}%, ` +
        `which usually means a unit mismatch or data-entry issue ` +
        `rather than a real performance gap. The overall comparison ` +
        `should be reviewed before being used in a decision.`,
    };
  }
  const distQualifier =
    absDist <= 5 ? "very close to"
    : absDist <= 15 ? "close to"
    : absDist <= 30 ? "moderately different from"
    : "noticeably different from";

  const sharedSpecs = `${matched} parameter${matched === 1 ? "" : "s"}`;
  const otherProducts = count > 1
    ? ` ${count - 1} other similar product${count - 1 === 1 ? "" : "s"} also informed the assessment.`
    : "";

  return {
    headline: `${distQualifier.charAt(0).toUpperCase() + distQualifier.slice(1)} ${peerName}`,
    explanation:
      `Across ${sharedSpecs}, this candidate is ${distQualifier} ` +
      `${peerName} (average ${Math.round(absDist)}% difference).${otherProducts}`,
  };
}

// ---------------------------------------------------------------------------
// $/kWh_exergy scalar explanation (CC-BE-EXRG-SURFACE-0044)
// ---------------------------------------------------------------------------

/**
 * Provenance fields on the USD/kWh_exergy scalar, mirroring
 * `DollarPerExergyProvenance` in brief-types.ts. Re-declared as a
 * minimal local shape so this module stays free of a circular
 * dependency on brief-types.
 */
export interface DollarPerExergyContext {
  produced: boolean;
  primaryMetricUnits: string;
  exergyKwhPerOutputUnit: number | null;
  exergyKwhPerOutputUnitSource:
    | "explicit"
    | "adapter_default"
    | "not_applicable"
    | string;
  exergyBasis: string;
  reasonAbsent?: string;
}

export interface DollarPerExergyExplanation {
  label: string;          // e.g., "$/kWh of useful exergy"
  value: string;          // e.g., "$0.125"
  unit: string;           // "USD/kWh_exergy" rendered as plain text
  explanation: string;    // 1-2 sentences, domain-aware
  sourceNote: string;     // where the conversion factor came from
  absent: boolean;
}

/**
 * Plain-language translation for the cross-domain $/kWh_exergy scalar.
 * Never shows raw labels ("adapter_default", "not_applicable",
 * "electrical_carrier_identity_tier0") — translates them into a
 * reason a reader can act on. Returns an `absent: true` bundle with
 * an explanation of why the scalar is missing when the backend could
 * not produce it honestly.
 */
export function explainDollarPerExergy(
  value: number | null | undefined,
  provenance: DollarPerExergyContext | null | undefined,
  opts: { domain?: string } = {},
): DollarPerExergyExplanation {
  const tech = domainLabel(opts.domain);
  const baseLabel = "Cost per kWh of useful work (exergy)";

  if (value == null || !provenance?.produced) {
    const reason = provenance?.reasonAbsent ?? "";
    let why: string;
    switch (reason) {
      case "no_exergy_profile_attached":
      case "no_exergy_status_attached":
        why =
          `No exergy profile was attached to this ${tech}, so the ` +
          `dollar-per-useful-work figure cannot be computed yet. ` +
          `It appears once the engine finishes the Tier-0 exergy pass.`;
        break;
      case "no_primary_cost_value":
        why =
          `The underlying levelized cost is not available for this ` +
          `${tech}, so the dollar-per-useful-work figure cannot be ` +
          `derived. Provide cost inputs to unlock this view.`;
        break;
      case "useful_exergy_below_floor":
        why =
          `Useful exergy came in below the numerical floor — dividing ` +
          `by it would produce an unstable number, so the scalar is ` +
          `withheld. Check the exergy ledger for input-side issues.`;
        break;
      case "missing_exergy_per_output_unit_conversion":
        why =
          `The fuel-to-exergy conversion factor was not supplied for ` +
          `this ${tech}, so the scalar cannot be computed without ` +
          `guessing. Supplying the chemical exergy of the fuel slate ` +
          `unlocks the view.`;
        break;
      default:
        if (reason && reason.startsWith("exergy_status_is_")) {
          const st = reason.replace("exergy_status_is_", "");
          why =
            `The exergy computation returned a "${st}" status for this ` +
            `${tech}, so a dollar-per-useful-work figure would carry ` +
            `untrustworthy noise and is withheld.`;
        } else {
          why =
            `A dollar-per-useful-work figure is not yet available for ` +
            `this ${tech}.`;
        }
    }
    return {
      label: baseLabel,
      value: "—",
      unit: "USD/kWh_exergy",
      explanation: why,
      sourceNote: "",
      absent: true,
    };
  }

  const formattedValue =
    Math.abs(value) < 0.01
      ? `$${value.toFixed(4)}`
      : Math.abs(value) < 1
        ? `$${value.toFixed(3)}`
        : `$${value.toFixed(2)}`;

  let explanation: string;
  if (provenance.primaryMetricUnits === "USD/MWh") {
    explanation =
      `This ${tech} delivers its output as electricity, so every kWh ` +
      `of electricity it stores or returns is one kWh of useful ` +
      `exergy. The number is the levelized cost per kWh of electrical ` +
      `output, translated onto the cross-domain "cost per useful work" ` +
      `axis for side-by-side comparison with fuels and heat.`;
  } else if (provenance.primaryMetricUnits === "USD/GGE") {
    explanation =
      `This ${tech} delivers a liquid fuel. We divided the levelized ` +
      `cost per gallon by the chemical exergy of that fuel (≈33.4 kWh ` +
      `per gasoline-gallon-equivalent) so it lines up, unit-for-unit, ` +
      `with electrical and thermal options on the cross-domain "cost ` +
      `per useful work" axis.`;
  } else {
    explanation =
      `The levelized cost was translated into dollars per kWh of ` +
      `useful exergy so this ${tech} can be compared directly against ` +
      `electrical, thermal, and fuel options on the same axis.`;
  }

  let sourceNote = "";
  switch (provenance.exergyKwhPerOutputUnitSource) {
    case "explicit":
      sourceNote =
        "Conversion factor supplied by the caller — not a platform default.";
      break;
    case "adapter_default":
      sourceNote =
        "Conversion factor is the platform's HHV-based default; override " +
        "with your own chemical exergy per fuel unit for higher precision.";
      break;
    case "not_applicable":
      sourceNote = "";  // Energy-denominated carrier — no conversion needed.
      break;
    default:
      sourceNote = "";
  }

  return {
    label: baseLabel,
    value: formattedValue,
    unit: "USD/kWh_exergy",
    explanation,
    sourceNote,
    absent: false,
  };
}

// ---------------------------------------------------------------------------
// Convenience: full brief-level explanation bundle
// ---------------------------------------------------------------------------

export interface BriefExplanationBundle {
  calibration: CalibrationExplanation;
  confidence: ConfidenceExplanation;
  hardFail: HardFailExplanation | null;
  peerMatch: PeerMatchExplanation | null;
}

export function explainBrief(brief: {
  calibration_tier?: string;
  avg_module_confidence?: number;
  hard_fail?: boolean;
  hard_fail_reasons?: string[];
  domain?: string;
  technology_family?: string;
  peer_matching?: {
    peer_count?: number;
    nearest_peer?: {
      commercial_name?: string;
      device_id?: string;
      overall_distance_pct?: number | null;
      n_matched_kpis?: number;
    } | null;
    upgrade_guidance?: string | null;
  } | null;
}): BriefExplanationBundle {
  const familyLabel = brief.technology_family
    ? brief.technology_family.replace(/_/g, " ")
    : undefined;
  return {
    calibration: explainCalibrationTier({
      tier: brief.calibration_tier || "",
      peerCount: brief.peer_matching?.peer_count ?? 0,
      domain: brief.domain,
      familyLabel,
      nearestPeerName: brief.peer_matching?.nearest_peer?.commercial_name,
      upgradeGuidance: brief.peer_matching?.upgrade_guidance ?? undefined,
    }),
    confidence: explainConfidence(brief.avg_module_confidence, {
      domain: brief.domain,
      tier: brief.calibration_tier,
    }),
    hardFail: brief.hard_fail
      ? explainHardFail(brief.hard_fail_reasons || [], { domain: brief.domain })
      : null,
    peerMatch: explainPeerMatch(brief.peer_matching, {
      domain: brief.domain,
      familyLabel,
    }),
  };
}
