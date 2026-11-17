import type { IsoDate, Period } from './types.js';

const pad = (n: number) => String(n).padStart(2, '0');

export function isIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date in Danish local time — the date someone in Denmark would write on a bilag. */
export function todayIso(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(now);
}

/**
 * The regnskabsår containing `date`, for a company whose year starts in
 * `startMonth` (1–12). The period id is its start date.
 */
export function fiscalYearFor(date: IsoDate, startMonth: number): Period {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const startYear = m >= startMonth ? y : y - 1;
  const startDate = `${startYear}-${pad(startMonth)}-01`;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  const endDate = `${endYear}-${pad(endMonth)}-${pad(lastDay)}`;
  const label = startMonth === 1 ? String(startYear) : `${startYear}/${String(endYear).slice(2)}`;
  return { startDate, endDate, label, status: 'open' };
}

/** "2026-03-07" → "7. mar. 2026" */
export function formatDate(date: IsoDate): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('da-DK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
