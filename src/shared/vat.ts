import type { Ore, VatRule } from './types.js';

/**
 * VAT contained in a gross amount: gross × rate / (1 + rate), rounded half up
 * to whole øre. 25 % VAT is therefore 20 % of the gross. Rounding is done once,
 * on the VAT; net is whatever is left, so net + VAT always equals gross.
 */
export function vatFromGross(gross: Ore, rateBp: number): Ore {
  if (rateBp <= 0) return 0;
  return Math.round((gross * rateBp) / (10_000 + rateBp));
}

/** Whether a rule produces a VAT line at all. */
export function postsVat(rule: VatRule | null | undefined): rule is VatRule {
  return (
    !!rule &&
    rule.kind === 'standard' &&
    (rule.direction === 'output' || rule.direction === 'input') &&
    rule.rate > 0
  );
}

/** "25 %" / "12,5 %" */
export function formatRate(rateBp: number): string {
  return `${(rateBp / 100).toLocaleString('da-DK', { maximumFractionDigits: 2 })} %`;
}
