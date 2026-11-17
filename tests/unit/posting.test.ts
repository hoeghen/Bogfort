import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNTS, DEFAULT_VAT_RULES } from '../../src/shared/chart';
import { buildPostingLines, PostingError, reverseLines, suggestContra, suggestKind } from '../../src/shared/posting';
import { vatFromGross } from '../../src/shared/vat';
import type { Account, VatRule } from '../../src/shared/types';

const acc = (n: string) => DEFAULT_ACCOUNTS.find((a) => a.number === n)!;
const vat = (c: string) => DEFAULT_VAT_RULES.find((v) => v.code === c)!;

const sum = (lines: { debit: number; credit: number }[]) =>
  lines.reduce((s, l) => ({ d: s.d + l.debit, c: s.c + l.credit }), { d: 0, c: 0 });

describe('vatFromGross', () => {
  it('is 20 % of the gross at 25 % VAT', () => {
    expect(vatFromGross(125000, 2500)).toBe(25000);
  });
  it('rounds to whole øre', () => {
    expect(vatFromGross(1, 2500)).toBe(0);
    expect(vatFromGross(3, 2500)).toBe(1);
    expect(vatFromGross(9999, 2500)).toBe(2000);
  });
  it('is 0 for a zero rate', () => {
    expect(vatFromGross(10000, 0)).toBe(0);
  });
});

describe('buildPostingLines', () => {
  it('books an expense with input VAT against the bank', () => {
    const lines = buildPostingLines({
      kind: 'expense',
      amount: 125000,
      account: acc('3600'),
      contra: acc('5000'),
      vatRule: vat('I25'),
      vatAccount: '6000',
    });
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ['3600', 100000, 0],
      ['6000', 25000, 0],
      ['5000', 0, 125000],
    ]);
    expect(lines[1]!.vatDirection).toBe('input');
    expect(lines[1]!.vatRate).toBe(2500);
  });

  it('books income with output VAT into the bank', () => {
    const lines = buildPostingLines({
      kind: 'income',
      amount: 125000,
      account: acc('1000'),
      contra: acc('5000'),
      vatRule: vat('U25'),
      vatAccount: '6000',
    });
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ['1000', 0, 100000],
      ['6000', 0, 25000],
      ['5000', 125000, 0],
    ]);
  });

  it('adds no VAT line for exempt income', () => {
    const lines = buildPostingLines({
      kind: 'income',
      amount: 50000,
      account: acc('1005'),
      contra: acc('5010'),
      vatRule: vat('MF'),
      vatAccount: '6000',
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.vatCode).toBe('MF');
  });

  it('always balances, whatever the rounding', () => {
    for (const amount of [1, 3, 7, 99, 101, 12345, 99999, 1234567]) {
      const { d, c } = sum(
        buildPostingLines({
          kind: 'expense',
          amount,
          account: acc('2000'),
          contra: acc('5000'),
          vatRule: vat('I25'),
          vatAccount: '6000',
        }),
      );
      expect(d).toBe(c);
      expect(d).toBe(amount);
    }
  });

  it('refuses sales VAT on an expense', () => {
    expect(() =>
      buildPostingLines({
        kind: 'expense',
        amount: 1000,
        account: acc('2000'),
        contra: acc('5000'),
        vatRule: vat('U25'),
        vatAccount: '6000',
      }),
    ).toThrow(PostingError);
  });

  it('refuses the VAT account as either side', () => {
    expect(() =>
      buildPostingLines({
        kind: 'expense',
        amount: 1000,
        account: acc('2000'),
        contra: acc('6000'),
        vatRule: null,
        vatAccount: '6000',
      }),
    ).toThrow(/Momskontoen/);
  });

  it('refuses the same account on both sides, inactive accounts and bad amounts', () => {
    const base = { kind: 'expense' as const, contra: acc('5000'), vatRule: null, vatAccount: '6000' };
    expect(() => buildPostingLines({ ...base, amount: 100, account: acc('5000') })).toThrow(/samme/);
    const inactive: Account = { ...acc('2000'), active: false };
    expect(() => buildPostingLines({ ...base, amount: 100, account: inactive })).toThrow(/deaktiveret/);
    expect(() => buildPostingLines({ ...base, amount: 0, account: acc('2000') })).toThrow(/større/);
    expect(() => buildPostingLines({ ...base, amount: 1.5, account: acc('2000') })).toThrow(/større/);
  });

  it('ignores a reverse-charge rule rather than inventing VAT for it', () => {
    const rc: VatRule = { ...vat('I25'), code: 'EU', kind: 'reverseCharge' };
    const lines = buildPostingLines({
      kind: 'expense',
      amount: 1000,
      account: acc('2000'),
      contra: acc('5000'),
      vatRule: rc,
      vatAccount: '6000',
    });
    expect(lines).toHaveLength(2);
  });
});

describe('reverseLines', () => {
  it('flips every debit and credit', () => {
    const lines = buildPostingLines({
      kind: 'expense',
      amount: 125000,
      account: acc('3600'),
      contra: acc('5000'),
      vatRule: vat('I25'),
      vatAccount: '6000',
    });
    const rev = reverseLines(lines);
    lines.forEach((l, i) => {
      expect(rev[i]!.debit).toBe(l.credit);
      expect(rev[i]!.credit).toBe(l.debit);
    });
  });
});

describe('suggestions', () => {
  it('uses the account default contra before the company default', () => {
    expect(suggestContra(acc('2000'), '5000')).toBe('5000');
    expect(suggestContra({ ...acc('2000'), defaultContraAccount: '6020' }, '5000')).toBe('6020');
  });
  it('treats income accounts as income and everything else as expense', () => {
    expect(suggestKind(acc('1000'))).toBe('income');
    expect(suggestKind(acc('3000'))).toBe('expense');
  });
});

describe('default chart', () => {
  it('only references VAT codes that exist', () => {
    const codes = new Set(DEFAULT_VAT_RULES.map((v) => v.code));
    for (const a of DEFAULT_ACCOUNTS) if (a.vatCode) expect(codes.has(a.vatCode)).toBe(true);
  });
  it('has exactly one system VAT account', () => {
    expect(DEFAULT_ACCOUNTS.filter((a) => a.system === 'vat').map((a) => a.number)).toEqual(['6000']);
  });
});
