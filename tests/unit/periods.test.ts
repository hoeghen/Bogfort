import { describe, expect, it } from 'vitest';
import { fiscalYearFor, isIsoDate, todayIso } from '../../src/shared/periods';
import { postedAttachmentPath, sanitizeFileName } from '../../src/shared/paths';

describe('fiscalYearFor', () => {
  it('handles calendar years', () => {
    expect(fiscalYearFor('2026-03-07', 1)).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      label: '2026',
      status: 'open',
    });
  });
  it('handles broken fiscal years', () => {
    expect(fiscalYearFor('2026-03-07', 7)).toMatchObject({
      startDate: '2025-07-01',
      endDate: '2026-06-30',
      label: '2025/26',
    });
    expect(fiscalYearFor('2026-07-01', 7).startDate).toBe('2026-07-01');
  });
  it('ends on the last day of February in leap years', () => {
    expect(fiscalYearFor('2028-01-10', 3).endDate).toBe('2028-02-29');
  });
});

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26-02-01')).toBe(false);
  });
  it('uses Danish local time for today', () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Copenhagen.
    expect(todayIso(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });
});

describe('paths', () => {
  it('follows /bilag/{vrid}/{aar}/{post-id}', () => {
    expect(postedAttachmentPath('c1', '2026', 'p1', 'Faktura 12.PDF')).toBe('bilag/c1/2026/p1.pdf');
  });
  it('sanitises file names', () => {
    expect(sanitizeFileName('kvittering æøå (1).jpg')).toMatch(/^[\w.\-]+$/);
  });
});
