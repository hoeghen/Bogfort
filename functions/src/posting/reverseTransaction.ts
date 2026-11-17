import {
  reverseLines,
  todayIso,
  type Company,
  type ReversalMarker,
  type Transaction,
  type VoucherCounter,
} from '../../../src/shared/index.js';
import { db } from '../lib/admin.js';
import { requireRole, requireString } from '../lib/access.js';
import { writeAudit } from '../lib/audit.js';
import { fail } from '../lib/errors.js';
import { POSTING_ROLES, resolvePeriod } from './postDrafts.js';
import { transactionHash } from './hash.js';

export interface ReverseTransactionRequest {
  companyId: string;
  postId: string;
  reason: string;
}

/**
 * Cancel a posted voucher with a modpostering: a new voucher, dated today,
 * with every line flipped. The original is untouched — that is the point.
 * A marker doc keyed by the original's id is created in the same transaction,
 * so the same voucher can never be reversed twice, even by two taps at once.
 */
export async function performReverseTransaction(
  uid: string,
  req: ReverseTransactionRequest,
): Promise<{ postId: string; voucherNumber: number }> {
  const companyId = req.companyId;
  const reason = requireString(req.reason, 'Begrundelse', 200);
  const companyRef = db.doc(`companies/${companyId}`);
  const postRef = companyRef.collection('transactions').doc();

  const voucherNumber = await db.runTransaction(async (tx) => {
    await requireRole(companyId, uid, [...POSTING_ROLES], tx);
    const originalRef = companyRef.collection('transactions').doc(String(req.postId));
    const markerRef = companyRef.collection('reversals').doc(String(req.postId));
    const counterRef = companyRef.collection('counters').doc('vouchers');

    const [originalSnap, markerSnap, companySnap, counterSnap] = await Promise.all([
      tx.get(originalRef),
      tx.get(markerRef),
      tx.get(companyRef),
      tx.get(counterRef),
    ]);
    const original = originalSnap.data() as Transaction | undefined;
    const company = companySnap.data() as Company | undefined;
    const counter = counterSnap.data() as VoucherCounter | undefined;
    if (!original) fail('not-found', 'Posteringen findes ikke.');
    if (!company || !counter) fail('internal', 'Virksomheden mangler data.');
    if (markerSnap.exists) fail('already-exists', `Bilag ${original.voucherNumber} er allerede modposteret.`);
    if (original.kind === 'reversal') fail('failed-precondition', 'En modpostering kan ikke selv modposteres.');

    const date = todayIso();
    const { period, isNew } = await resolvePeriod(tx, companyId, company, date);
    const number = counter.last + 1;
    const base: Omit<Transaction, 'hash'> = {
      postId: postRef.id,
      voucherNumber: number,
      date,
      periodId: period.startDate,
      text: `Modpostering af bilag ${original.voucherNumber}: ${reason}`.slice(0, 200),
      kind: 'reversal',
      lines: reverseLines(original.lines),
      amount: original.amount,
      // The documentation for the reversal is the original bilag itself.
      attachment: original.attachment,
      reverses: original.postId,
      reversesVoucher: original.voucherNumber,
      postedAt: Date.now(),
      postedBy: uid,
      prevHash: counter.lastHash,
    };
    const hash = transactionHash(base);

    if (isNew) {
      tx.set(companyRef.collection('periods').doc(period.startDate), period);
      writeAudit(tx, companyId, 'period.created', uid, period.startDate, { label: period.label });
    }
    tx.create(postRef, { ...base, hash } satisfies Transaction);
    tx.create(markerRef, { reversedBy: postRef.id, reversedByVoucher: number, at: Date.now() } satisfies ReversalMarker);
    tx.set(counterRef, { last: number, lastHash: hash } satisfies VoucherCounter);
    writeAudit(tx, companyId, 'transaction.reversed', uid, original.postId, {
      voucherNumber: number,
      reversesVoucher: original.voucherNumber,
      reason,
    });
    return number;
  });

  return { postId: postRef.id, voucherNumber };
}
