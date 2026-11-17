import type { Account, DraftKind, Ore, PostingLine, VatRule } from './types.js';
import { postsVat, vatFromGross } from './vat.js';

export interface PostingInput {
  kind: DraftKind;
  amount: Ore;
  account: Account;
  contra: Account;
  vatRule: VatRule | null;
  vatAccount: string;
}

export class PostingError extends Error {
  constructor(
    public readonly code:
      | 'invalid-amount'
      | 'same-account'
      | 'inactive-account'
      | 'vat-on-contra'
      | 'vat-direction'
      | 'unbalanced',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Turn one kassekladde line into balanced double-entry lines.
 *
 * Expense, 1.250 kr. on 3600 with I25, paid from 5000:
 *   3600 debit 1.000 · 6000 debit 250 · 5000 credit 1.250
 * Income, 1.250 kr. on 1000 with U25, into 5000:
 *   5000 debit 1.250 · 1000 credit 1.000 · 6000 credit 250
 *
 * VAT always sits on the chosen account's side, never on the contra: the
 * contra is where the money actually moved, and moves the gross.
 */
export function buildPostingLines(input: PostingInput): PostingLine[] {
  const { kind, amount, account, contra, vatRule, vatAccount } = input;

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new PostingError('invalid-amount', 'Beløbet skal være større end 0.');
  }
  if (account.number === contra.number) {
    throw new PostingError('same-account', 'Konto og modkonto kan ikke være den samme.');
  }
  if (!account.active || !contra.active) {
    throw new PostingError('inactive-account', 'Kontoen er deaktiveret.');
  }
  if (account.number === vatAccount || contra.number === vatAccount) {
    throw new PostingError('vat-on-contra', 'Momskontoen bogføres automatisk og kan ikke vælges.');
  }

  const vat = postsVat(vatRule) ? vatFromGross(amount, vatRule.rate) : 0;
  if (vat > 0 && vatRule) {
    // Booking sales VAT on a purchase (or the reverse) would silently invert
    // the momsangivelse, so the direction has to match what the money does.
    const expected = kind === 'expense' ? 'input' : 'output';
    if (vatRule.direction !== expected) {
      throw new PostingError(
        'vat-direction',
        kind === 'expense'
          ? 'En udgift kan ikke have udgående moms.'
          : 'En indtægt kan ikke have indgående moms.',
      );
    }
  }
  const net = amount - vat;
  const debitSide = kind === 'expense';

  const line = (acc: string, value: Ore, debit: boolean, extra: Partial<PostingLine> = {}): PostingLine => ({
    account: acc,
    debit: debit ? value : 0,
    credit: debit ? 0 : value,
    vatCode: null,
    vatDirection: null,
    vatRate: null,
    ...extra,
  });

  const lines: PostingLine[] = [
    line(account.number, net, debitSide, {
      vatCode: vatRule?.code ?? null,
      vatRate: vatRule && vat > 0 ? vatRule.rate : null,
    }),
  ];
  if (vat > 0 && vatRule) {
    lines.push(
      line(vatAccount, vat, debitSide, {
        vatCode: vatRule.code,
        vatDirection: vatRule.direction,
        vatRate: vatRule.rate,
      }),
    );
  }
  lines.push(line(contra.number, amount, !debitSide));

  assertBalanced(lines);
  return lines;
}

/** Debit equals credit, or the voucher must not exist. */
export function assertBalanced(lines: PostingLine[]): void {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0 || (l.debit > 0 && l.credit > 0)) {
      throw new PostingError('unbalanced', 'En linje kan ikke være både debet og kredit.');
    }
    debit += l.debit;
    credit += l.credit;
  }
  if (debit !== credit || debit === 0) {
    throw new PostingError('unbalanced', 'Posteringen balancerer ikke.');
  }
}

/** The lines of a reversal: every debit becomes a credit and vice versa. */
export function reverseLines(lines: PostingLine[]): PostingLine[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

/** Pick the contra account: the chosen account's own default, then the company default. */
export function suggestContra(account: Account | undefined, companyDefault: string): string {
  return account?.defaultContraAccount ?? companyDefault;
}

/** The kind a freshly picked account implies. */
export function suggestKind(account: Account | undefined): DraftKind {
  return account?.type === 'income' ? 'income' : 'expense';
}
