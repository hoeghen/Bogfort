import { createHash } from 'node:crypto';
import type { Transaction } from '../../../src/shared/index.js';

/** JSON with keys sorted at every level, so the same content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Hash a voucher together with the previous voucher's hash. The chain makes
 * tampering evident: changing, removing or reordering any posted voucher
 * breaks every hash after it, which `verifyChain` can show without trusting
 * the database that holds them.
 */
export function transactionHash(t: Omit<Transaction, 'hash'>): string {
  return sha256Hex(
    canonicalJson({
      postId: t.postId,
      voucherNumber: t.voucherNumber,
      date: t.date,
      periodId: t.periodId,
      text: t.text,
      kind: t.kind,
      lines: t.lines,
      amount: t.amount,
      attachmentSha256: t.attachment?.sha256 ?? null,
      reverses: t.reverses,
      postedAt: t.postedAt,
      postedBy: t.postedBy,
      prevHash: t.prevHash,
    }),
  );
}

/** Returns the first voucher number whose hash does not check out, or null if the chain is intact. */
export function verifyChain(transactions: Transaction[]): number | null {
  const sorted = [...transactions].sort((a, b) => a.voucherNumber - b.voucherNumber);
  let prev = '';
  let expected = 1;
  for (const t of sorted) {
    if (t.voucherNumber !== expected || t.prevHash !== prev) return t.voucherNumber;
    const { hash, ...rest } = t;
    if (transactionHash(rest) !== hash) return t.voucherNumber;
    prev = hash;
    expected++;
  }
  return null;
}
