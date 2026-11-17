import type { Transaction as FsTransaction } from 'firebase-admin/firestore';
import {
  buildPostingLines,
  fiscalYearFor,
  isIsoDate,
  todayIso,
  type Account,
  type Company,
  type Draft,
  type Period,
  type PostedAttachment,
  type Transaction,
  type VatRule,
  type VoucherCounter,
} from '../../../src/shared/index.js';
import { db } from '../lib/admin.js';
import { requireRole } from '../lib/access.js';
import { writeAudit } from '../lib/audit.js';
import { fail, toHttpsError } from '../lib/errors.js';
import { deleteQuietly, promoteAttachment } from './attachments.js';
import { transactionHash } from './hash.js';

export const POSTING_ROLES = ['owner', 'bookkeeper'] as const;

export interface PostDraftsRequest {
  companyId: string;
  draftIds: string[];
}

export interface PostDraftsResult {
  posted: { draftId: string; postId: string; voucherNumber: number }[];
  failed: { draftId: string; message: string }[];
}

/**
 * Resolve (and if needed open) the regnskabsår a posting date falls in.
 * Posting into a closed year is refused; so is a date after the end of the
 * current year, which is far more likely a typo than a real bilag.
 */
export async function resolvePeriod(
  tx: FsTransaction,
  companyId: string,
  company: Company,
  date: string,
): Promise<{ period: Period; isNew: boolean }> {
  if (!isIsoDate(date) || date < '2000-01-01') fail('invalid-argument', 'Ugyldig dato.');
  const current = fiscalYearFor(todayIso(), company.fiscalYearStartMonth);
  if (date > current.endDate) fail('failed-precondition', 'Datoen ligger efter det igangværende regnskabsår.');

  const wanted = fiscalYearFor(date, company.fiscalYearStartMonth);
  const snap = await tx.get(db.doc(`companies/${companyId}/periods/${wanted.startDate}`));
  if (snap.exists) {
    const period = snap.data() as Period;
    if (period.status === 'closed') fail('failed-precondition', `Regnskabsåret ${period.label} er lukket.`);
    return { period, isNew: false };
  }
  return { period: wanted, isNew: true };
}

function validateDraft(d: Draft | undefined): Draft {
  if (!d) fail('not-found', 'Kladdelinjen findes ikke længere.');
  if (typeof d.text !== 'string' || d.text.trim() === '') fail('invalid-argument', 'Tekst mangler.');
  if (!Number.isSafeInteger(d.amount) || d.amount <= 0) fail('invalid-argument', 'Ugyldigt beløb.');
  if (d.kind !== 'expense' && d.kind !== 'income') fail('invalid-argument', 'Ugyldig posteringstype.');
  if (d.attachmentPending) fail('failed-precondition', 'Bilaget venter stadig på at blive uploadet.');
  if (!d.attachment) fail('failed-precondition', 'Vedhæft et bilag før du bogfører.');
  return d;
}

/**
 * Post one draft. The bilag is promoted first (it needs network I/O that has
 * no place inside a Firestore transaction); then a single transaction checks
 * everything again, takes the next voucher number, writes the voucher, its
 * audit entry and deletes the draft. Two posts racing for the counter retry
 * inside Firestore's transaction loop and get consecutive numbers — never the
 * same one, never a gap.
 */
export async function postOneDraft(
  uid: string,
  companyId: string,
  draftId: string,
): Promise<{ postId: string; voucherNumber: number }> {
  await requireRole(companyId, uid, [...POSTING_ROLES]);
  const companyRef = db.doc(`companies/${companyId}`);
  const draftRef = companyRef.collection('drafts').doc(draftId);

  const initial = validateDraft((await draftRef.get()).data() as Draft | undefined);
  const postRef = companyRef.collection('transactions').doc();
  const year = initial.date.slice(0, 4);
  const attachment: PostedAttachment = await promoteAttachment(
    companyId,
    draftId,
    initial.attachment!,
    year,
    postRef.id,
  );

  try {
    const voucherNumber = await db.runTransaction(async (tx) => {
      await requireRole(companyId, uid, [...POSTING_ROLES], tx);
      const draft = validateDraft((await tx.get(draftRef)).data() as Draft | undefined);
      // The file we hashed must still be the one the draft points at.
      if (draft.updatedAt !== initial.updatedAt || draft.attachment?.path !== initial.attachment?.path) {
        fail('aborted', 'Kladdelinjen blev ændret undervejs. Prøv igen.');
      }

      const company = (await tx.get(companyRef)).data() as Company | undefined;
      if (!company) fail('not-found', 'Virksomheden findes ikke.');
      const counterRef = companyRef.collection('counters').doc('vouchers');
      const counter = (await tx.get(counterRef)).data() as VoucherCounter | undefined;
      if (!counter) fail('internal', 'Bilagstælleren mangler.');

      const [accountSnap, contraSnap] = await Promise.all([
        tx.get(companyRef.collection('accounts').doc(String(draft.account))),
        tx.get(companyRef.collection('accounts').doc(String(draft.contraAccount))),
      ]);
      const account = accountSnap.data() as Account | undefined;
      const contra = contraSnap.data() as Account | undefined;
      if (!account) fail('invalid-argument', `Konto ${draft.account} findes ikke.`);
      if (!contra) fail('invalid-argument', `Modkonto ${draft.contraAccount} findes ikke.`);

      let vatRule: VatRule | null = null;
      if (draft.vatCode) {
        vatRule = ((await tx.get(companyRef.collection('vat_rules').doc(String(draft.vatCode)))).data() ??
          null) as VatRule | null;
        if (!vatRule || !vatRule.active) fail('invalid-argument', 'Momsreglen findes ikke.');
        if (vatRule.kind !== 'standard') fail('unimplemented', 'Denne momstype understøttes ikke endnu.');
      }

      const { period, isNew } = await resolvePeriod(tx, companyId, company, draft.date);
      const lines = buildPostingLines({
        kind: draft.kind,
        amount: draft.amount,
        account,
        contra,
        vatRule,
        vatAccount: company.vatAccount,
      });

      const number = counter.last + 1;
      const base: Omit<Transaction, 'hash'> = {
        postId: postRef.id,
        voucherNumber: number,
        date: draft.date,
        periodId: period.startDate,
        text: draft.text.trim().slice(0, 200),
        kind: draft.kind,
        lines,
        amount: draft.amount,
        attachment,
        reverses: null,
        reversesVoucher: null,
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
      tx.set(counterRef, { last: number, lastHash: hash } satisfies VoucherCounter);
      tx.delete(draftRef);
      writeAudit(tx, companyId, 'transaction.posted', uid, postRef.id, {
        voucherNumber: number,
        draftId,
        amount: draft.amount,
        attachmentSha256: attachment.sha256,
      });
      return number;
    });

    await deleteQuietly(initial.attachment!.path);
    return { postId: postRef.id, voucherNumber };
  } catch (err) {
    await deleteQuietly(attachment.path);
    throw err;
  }
}

/**
 * Post several drafts in date order, each in its own transaction. One bad
 * line does not hold the others back; the result says which failed and why.
 */
export async function performPostDrafts(uid: string, req: PostDraftsRequest): Promise<PostDraftsResult> {
  await requireRole(req.companyId, uid, [...POSTING_ROLES]);
  if (!Array.isArray(req.draftIds) || req.draftIds.length === 0) fail('invalid-argument', 'Ingen linjer valgt.');
  if (req.draftIds.length > 100) fail('invalid-argument', 'Bogfør højst 100 linjer ad gangen.');
  const ids = [...new Set(req.draftIds.map(String))];

  const refs = ids.map((id) => db.doc(`companies/${req.companyId}/drafts/${id}`));
  const snaps = await db.getAll(...refs);
  const order = snaps
    .map((s) => ({ id: s.id, d: s.data() as Draft | undefined }))
    .sort((a, b) =>
      (a.d?.date ?? '').localeCompare(b.d?.date ?? '') || (a.d?.createdAt ?? 0) - (b.d?.createdAt ?? 0),
    );

  const result: PostDraftsResult = { posted: [], failed: [] };
  for (const { id } of order) {
    try {
      const r = await postOneDraft(uid, req.companyId, id);
      result.posted.push({ draftId: id, ...r });
    } catch (err) {
      const e = toHttpsError(err) as { message?: string };
      result.failed.push({ draftId: id, message: e.message ?? 'Ukendt fejl.' });
    }
  }
  return result;
}
