/**
 * Pure finance-math for the EconomicsExplorer interactive surface.
 *
 * Extracted from ``components/interactive/EconomicsExplorer.tsx`` so the
 * LCOE computation can be tested without dragging JSX through the Jest
 * pipeline (CC-BE-FIX-0012). The component re-exports these symbols so
 * downstream callers are unaffected.
 */

export interface EconParams {
  capex_per_kw: number;
  opex_per_kw_year: number;
  discount_rate: number;
  lifetime_years: number;
  capacity_factor: number;
  degradation_rate: number;
  electricity_price: number;
  capacity_kw: number;
}

/**
 * Discount-rate lower bound. The discount factor ``(1 + discount_rate)^y``
 * collapses to zero at discount_rate == -1 (divide-by-zero when used as a
 * denominator) and becomes negative below that, producing nonsense LCOE
 * figures. We reject anything at or below -0.999 as outside the valid
 * finance regime; real-world rates are almost always in [0, 0.20].
 * CC-BE-FIX-0012.
 */
export const MIN_DISCOUNT_RATE = -0.999;

export interface LCOEResult {
  lcoe: number;
  paybackYear: number;
  totalCapex: number;
  totalOpex: number;
  totalRevenue: number;
  npv: number;
  annualCosts: Array<{
    year: number;
    capex: number;
    opex: number;
    revenue: number;
    cumulative: number;
  }>;
  /** Populated when inputs were out of a valid regime; undefined otherwise. */
  error?: string;
}

export function computeLCOE(p: EconParams): LCOEResult {
  // Guard the one input that can push math out of a valid regime. The
  // discount factor collapses or goes negative at discount_rate <= -1,
  // which silently poisons LCOE/NPV. Fail loudly and let the caller render
  // an error state instead of a bogus number. CC-BE-FIX-0012.
  if (!Number.isFinite(p.discount_rate) || p.discount_rate <= MIN_DISCOUNT_RATE) {
    return {
      lcoe: 0,
      paybackYear: p.lifetime_years,
      totalCapex: p.capex_per_kw * p.capacity_kw,
      totalOpex: 0,
      totalRevenue: 0,
      npv: 0,
      annualCosts: [],
      error: `Invalid discount_rate=${p.discount_rate} (must be > ${MIN_DISCOUNT_RATE})`,
    };
  }

  let totalCost = 0;
  let totalEnergy = 0;
  const annualCosts: LCOEResult["annualCosts"] = [];

  const totalCapex = p.capex_per_kw * p.capacity_kw;
  let cumulative = -totalCapex;

  for (let y = 1; y <= p.lifetime_years; y++) {
    const df = Math.pow(1 + p.discount_rate, y);
    const degradation = Math.pow(1 - p.degradation_rate, y - 1);
    const yearlyOutput = p.capacity_kw * p.capacity_factor * 8760 * degradation; // kWh
    const yearlyOpex = p.opex_per_kw_year * p.capacity_kw;
    const yearlyRevenue = yearlyOutput * p.electricity_price;

    totalCost += (yearlyOpex / df) + (y === 1 ? totalCapex : 0);
    totalEnergy += yearlyOutput / df;

    cumulative += yearlyRevenue - yearlyOpex;

    annualCosts.push({
      year: y,
      capex: y === 1 ? totalCapex : 0,
      opex: yearlyOpex,
      revenue: yearlyRevenue,
      cumulative,
    });
  }

  const lcoe = totalEnergy > 0 ? (totalCapex + totalCost) / totalEnergy : 0;
  const paybackYear = annualCosts.find((a) => a.cumulative >= 0)?.year || p.lifetime_years;
  const totalRevenue = annualCosts.reduce((s, a) => s + a.revenue, 0);
  const totalOpex = annualCosts.reduce((s, a) => s + a.opex, 0);
  const npv = totalRevenue - totalCapex - totalOpex;

  return { lcoe, paybackYear, totalCapex, totalOpex, totalRevenue, npv, annualCosts };
}
