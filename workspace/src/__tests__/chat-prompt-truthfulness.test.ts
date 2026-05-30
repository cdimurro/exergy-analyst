/**
 * Static regression tests for workspace chat prompt truthfulness.
 *
 * CC-BE-GOV-0108: locks out the Codex-identified overclaims and
 * credibility-tier contradictions in
 * ``workspace/src/app/api/projects/[id]/chat/route.ts``. These tests
 * read the file as a string and grep for forbidden substrings + the
 * presence of the new public-vocabulary guidance. No UI/mock harness
 * needed — if the offending text ever comes back, the test fails.
 *
 * Sibling coverage:
 *   - CC-BE-GOV-0109 (mock sidecar default): actions-mock-sidecar
 *   - CC-BE-GOV-0110 (solver status rendering): covered by the
 *     actions-route tests once status plumbing lands.
 *   - CC-BE-GOV-0111: additional behavior locks pile on this file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHAT_ROUTE_PATH = join(
  __dirname,
  "..",
  "app",
  "api",
  "projects",
  "[id]",
  "chat",
  "route.ts",
);

const chatRouteSource = readFileSync(CHAT_ROUTE_PATH, "utf-8");

describe("chat prompt truthfulness (CC-BE-GOV-0108)", () => {
  // ── Forbidden overclaim strings ─────────────────────────────────

  it("does not claim every domain has a real physics solver", () => {
    // Both the original phrasings flagged by Codex (P1 finding) and
    // any close variants ("every domain has a real solver" /
    // "every domain has a real physics solver") are banned.
    expect(chatRouteSource).not.toMatch(/every domain has a real (physics )?solver/i);
  });

  it("does not say to use physics simulation for any domain", () => {
    // The old prompt instructed the assistant to use
    // physics_simulation for ANY of the 101 domains — this is the
    // exact class of overclaim being stripped.
    expect(chatRouteSource).not.toMatch(/use physics_simulation for ANY domain/i);
    expect(chatRouteSource).not.toMatch(
      /real physics solvers for ANY of the 101 domains/i,
    );
  });

  it("does not claim universal solver coverage across ALL domains", () => {
    // Variants that imply universal coverage.
    expect(chatRouteSource).not.toMatch(
      /covering ALL 10[0-9] domains\b/,
    );
    expect(chatRouteSource).not.toMatch(
      /every domain has a real solver that produces computed metrics/i,
    );
  });

  it("does not claim the solver produces real computed metrics, not estimates", () => {
    // The original prompt boasted "produces real computed metrics,
    // not estimates" universally. With 0105/0106/0107 landed, any
    // single run can be unavailable/validation_failed/etc., so this
    // framing is dishonest.
    expect(chatRouteSource).not.toMatch(
      /produces? real computed metrics\s*[—-]\s*not estimates/i,
    );
  });

  it('does not say "You can confidently say \\"simulate\\" and \\"compute\\" for any domain"', () => {
    expect(chatRouteSource).not.toMatch(
      /confidently say "simulate" and "compute" for any domain/i,
    );
  });

  // ── Forbidden C3/credibility contradiction ──────────────────────

  it("does not tell the assistant to reference the credibility tier externally", () => {
    // The old prompt said "reference the credibility tier" in one
    // section while another section said "Never reference ...
    // credibility tiers (C0-C3)". Both can't be true; only the
    // no-tier rule should survive.
    expect(chatRouteSource).not.toMatch(
      /reference the credibility tier\.?/i,
    );
  });

  it("does not pre-upgrade plan templates to validated or definitive readiness", () => {
    expect(chatRouteSource).not.toMatch(/\bphysics-validated performance\b/i);
    expect(chatRouteSource).not.toMatch(/\bvalidated physics\b/i);
    expect(chatRouteSource).not.toMatch(/\bdefinitive deployment readiness\b/i);
    expect(chatRouteSource).not.toMatch(/\bDEFINITIVE assessment\b/);
    expect(chatRouteSource).not.toMatch(/\bdefinitive commercial viability verdict\b/i);
    expect(chatRouteSource).not.toMatch(/\bdecision[-\s]?grade TEA\b/i);
    expect(chatRouteSource).not.toMatch(/\bdecision[-\s]?grade confidence\b/i);
    expect(chatRouteSource).not.toMatch(/\binvestment thesis\b/i);
    expect(chatRouteSource).not.toMatch(/\binvestable today\b/i);
    expect(chatRouteSource).toMatch(/\bbounded physics findings and solver status\b/i);
    expect(chatRouteSource).toMatch(/\bevidence-bounded diligence thesis\b/i);
  });

  it("keeps the 'never reference credibility tiers' guidance", () => {
    // Make the surviving side of the old contradiction observable.
    expect(chatRouteSource).toMatch(
      /Never reference[\s\S]{0,120}credibility tiers? \(C0-C3\)/i,
    );
  });

  // ── New public vocabulary present ───────────────────────────────

  it("routes to the strongest available governed analysis path", () => {
    // The canonical replacement phrasing from the batch spec.
    expect(chatRouteSource).toMatch(
      /routes? (each evaluation )?to the strongest available governed analysis path/i,
    );
  });

  it('uses the single public vocabulary (calibrated simulation / engineering estimate / not computed / blocked / unavailable)', () => {
    expect(chatRouteSource).toMatch(/calibrated simulation/i);
    expect(chatRouteSource).toMatch(/engineering estimate/i);
    expect(chatRouteSource).toMatch(/not computed/i);
    expect(chatRouteSource).toMatch(/\bblocked\b/i);
    expect(chatRouteSource).toMatch(/\bunavailable\b/i);
  });

  it("mentions the solver status taxonomy wired by CC-BE-GOV-0107", () => {
    // The prompt must tell the assistant that only status=="ran" is
    // solver-backed, and must name the non-ran states it should
    // render as "not computed".
    expect(chatRouteSource).toMatch(/status of "ran" is solver-backed/i);
    expect(chatRouteSource).toMatch(/unavailable/);
    expect(chatRouteSource).toMatch(/validation_failed/);
    expect(chatRouteSource).toMatch(/dispatch_error/);
    expect(chatRouteSource).toMatch(/not_registered/);
  });

  // ── "Do NOT lead with gaps" must not apply to decision-critical ──

  it("does not unconditionally suppress leading with blocking gaps", () => {
    // The original text said "But do NOT lead with gaps". The fix
    // qualifies it: decision-critical blocks (hard_fail /
    // promotion_blocked / solver veto) must still lead.
    const m = chatRouteSource.match(/do NOT lead with gaps[\s\S]{0,120}/i);
    if (m) {
      // If the phrase still appears, it must be qualified by the
      // decision-critical exception clause.
      expect(chatRouteSource).toMatch(
        /If the run was hard_fail, promotion_blocked, or solver-vetoed, LEAD with that block/i,
      );
    }
  });

  // ── Brief renderer emits the public vocabulary ──────────────────

  it("brief-state renderer emits Methodology, not internal C3 label", () => {
    // The PROJECT STATE stringifier previously wrote
    // "Credibility: C3 (calibrated simulation)" into the prompt
    // context. Internal labels must not leak; the Methodology line
    // uses the public vocabulary only.
    expect(chatRouteSource).toMatch(/Methodology: \$\{methodology\}/);
    expect(chatRouteSource).not.toMatch(
      /Credibility:\s*\$\{credTier\}\s*\(/,
    );
  });
});
