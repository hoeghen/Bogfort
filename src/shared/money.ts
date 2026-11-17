import type { Ore } from './types.js';

/**
 * Parse an amount typed the Danish way ("1.234,50", "1234,5", "12") into øre.
 * A dot followed by exactly three digits is a thousands separator; any other
 * single dot is read as a decimal point, so "12.50" pasted from a bank
 * statement still means twelve kroner fifty. Returns null for anything that is
 * not a positive amount with at most two decimals.
 */
export function parseAmount(input: string): Ore | null {
  let s = input.trim().replace(/\s|kr\.?|dkk/gi, '');
  if (s === '') return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const ore = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(ore) || ore <= 0) return null;
  return ore;
}

const formatter = new Intl.NumberFormat('da-DK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123450 → "1.234,50" */
export function formatAmount(ore: Ore): string {
  return formatter.format(ore / 100);
}

/** 123450 → "1.234,50 kr." */
export function formatKr(ore: Ore): string {
  return `${formatAmount(ore)} kr.`;
}
