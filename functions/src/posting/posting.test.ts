import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry, Transaction } from '../../../src/shared/index.js';
import { bucket } from '../lib/admin.js';
import { db, makeCompany, makeDraft, OWNER, PDF_BYTES, resetEmulators } from '../test/harness.js';
import { performUpsertAccount } from '../settings/upsertAccount.js';
import { performPostDrafts, postOneDraft } from './postDrafts.js';
import { performReverseTransaction } from './reverseTransaction.js';
import { sha256Hex, verifyChain } from './hash.js';

beforeEach(resetEmulators);

const transactions = async (cid: string) =>
  (await db.collection(`companies/${cid}/transactions`).orderBy('voucherNumber').get()).docs.map(
    (d) => d.data() as Transaction,
  );

describe('postDrafts', () => {
  it('turns a draft into a balanced voucher with number 1, a hashed bilag and an audit entry', async () => {
    const cid = await makeCompany();
    const draftId = await makeDraft(cid);
    const res = await performPostDrafts(OWNER, { companyId: cid, draftIds: [draftId] });
    expect(res.failed).toEqual([]);
    expect(res.posted).toHaveLength(1);

    const [t] = await transactions(cid);
    expect(t).toBeDefined();
    expect(t!.voucherNumber).toBe(1);
    expect(t!.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ['3600', 100000, 0],
      ['6000', 25000, 0],
      ['5000', 0, 125000],
    ]);
    expect(t!.prevHash).toBe('');
    expect(t!.attachment?.sha256).toBe(sha256Hex(PDF_BYTES));
    const year = t!.date.slice(0, 4);
    expect(t!.attachment?.path).toBe(`bilag/${cid}/${year}/${t!.postId}.pdf`);

    // Draft and its upload are gone; the permanent file is there.
    expect((await db.doc(`companies/${cid}/drafts/${draftId}`).get()).exists).toBe(false);
    expect((await bucket().file(`bilag/${cid}/drafts/${draftId}/faktura.pdf`).exists())[0]).toBe(false);
    expect((await bucket().file(t!.attachment!.path).exists())[0]).toBe(true);

    const log = (await db.collection(`companies/${cid}/auditLog`).get()).docs.map((d) => d.data() as AuditEntry);
    expect(log.some((e) => e.action === 'transaction.posted' && e.target === t!.postId)).toBe(true);
  });

  it('numbers vouchers consecutively in date order and chains their hashes', async () => {
    const cid = await makeCompany();
    const year = new Date().getFullYear();
    const late = await makeDraft(cid, { date: `${year}-01-20`, text: 'Sen' });
    const early = await makeDraft(cid, { date: `${year}-01-05`, text: 'Tidlig' });
    await performPostDrafts(OWNER, { companyId: cid, draftIds: [late, early] });
    const ts = await transactions(cid);
    expect(ts.map((t) => [t.voucherNumber, t.text])).toEqual([
      [1, 'Tidlig'],
      [2, 'Sen'],
    ]);
    expect(ts[1]!.prevHash).toBe(ts[0]!.hash);
    expect(verifyChain(ts)).toBeNull();
    expect(verifyChain([ts[0]!, { ...ts[1]!, amount: 1 }])).toBe(2);
  });

  it('gives concurrent posts distinct, gapless numbers', async () => {
    const cid = await makeCompany();
    const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => makeDraft(cid, { text: `Linje ${i}` })));
    const results = await Promise.all(ids.map((id) => postOneDraft(OWNER, cid, id)));
    expect(results.map((r) => r.voucherNumber).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(verifyChain(await transactions(cid))).toBeNull();
    expect((await db.doc(`companies/${cid}/counters/vouchers`).get()).data()?.['last']).toBe(6);
  });

  it('posts the same draft at most once when tapped twice', async () => {
    const cid = await makeCompany();
    const id = await makeDraft(cid);
    const results = await Promise.allSettled([postOneDraft(OWNER, cid, id), postOneDraft(OWNER, cid, id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await transactions(cid)).toHaveLength(1);
  });

  it('requires a bilag, and one that has actually been uploaded', async () => {
    const cid = await makeCompany();
    const none = await makeDraft(cid, { attachment: null });
    const pending = await makeDraft(cid, { attachmentPending: true });
    const missing = await makeDraft(cid, {}, { upload: false });
    const res = await performPostDrafts(OWNER, { companyId: cid, draftIds: [none, pending, missing] });
    expect(res.posted).toEqual([]);
    expect(res.failed.map((f) => f.message).sort()).toEqual(
      ['Bilaget er ikke uploadet endnu.', 'Bilaget venter stadig på at blive uploadet.', 'Vedhæft et bilag før du bogfører.'].sort(),
    );
  });

  it('refuses a bilag pointing at another draft', async () => {
    const cid = await makeCompany();
    const other = await makeDraft(cid);
    const otherDraft = (await db.doc(`companies/${cid}/drafts/${other}`).get()).data()!;
    const id = await makeDraft(cid, { attachment: otherDraft['attachment'] }, { upload: false });
    const res = await performPostDrafts(OWNER, { companyId: cid, draftIds: [id] });
    expect(res.failed[0]?.message).toMatch(/hører ikke til/);
  });

  it('refuses dates after the current fiscal year, bad VAT direction and inactive accounts', async () => {
    const cid = await makeCompany();
    const future = await makeDraft(cid, { date: `${new Date().getFullYear() + 1}-06-01` });
    const wrongVat = await makeDraft(cid, { vatCode: 'U25' });
    await performUpsertAccount(OWNER, {
      companyId: cid,
      number: '3000',
      name: 'Lokaler',
      vatCode: 'I25',
      defaultContraAccount: null,
      active: false,
    });
    const inactive = await makeDraft(cid, { account: '3000' });
    const res = await performPostDrafts(OWNER, { companyId: cid, draftIds: [future, wrongVat, inactive] });
    expect(res.posted).toEqual([]);
    expect(res.failed).toHaveLength(3);
    // Nothing was issued, so the next good voucher is still number 1.
    const ok = await makeDraft(cid);
    expect((await postOneDraft(OWNER, cid, ok)).voucherNumber).toBe(1);
  });

  it('cleans up the promoted file when the transaction fails', async () => {
    const cid = await makeCompany();
    const id = await makeDraft(cid, { vatCode: 'U25' });
    await expect(postOneDraft(OWNER, cid, id)).rejects.toThrow();
    const [files] = await bucket().getFiles({ prefix: `bilag/${cid}/` });
    expect(files.map((f) => f.name)).toEqual([`bilag/${cid}/drafts/${id}/faktura.pdf`]);
  });

  it('refuses callers without a posting role', async () => {
    const cid = await makeCompany();
    const id = await makeDraft(cid);
    await expect(performPostDrafts('stranger', { companyId: cid, draftIds: [id] })).rejects.toThrow(/adgang/);
    await db.doc(`companies/${cid}/members/auditor`).set({ uid: 'auditor', email: null, roles: ['auditor'], addedAt: 0 });
    await expect(performPostDrafts('auditor', { companyId: cid, draftIds: [id] })).rejects.toThrow(/adgang/);
  });
});

describe('reverseTransaction', () => {
  it('creates a flipped voucher referencing the original, exactly once', async () => {
    const cid = await makeCompany();
    const { postId } = await postOneDraft(OWNER, cid, await makeDraft(cid));
    const results = await Promise.allSettled([
      performReverseTransaction(OWNER, { companyId: cid, postId, reason: 'Fejlpostering' }),
      performReverseTransaction(OWNER, { companyId: cid, postId, reason: 'Fejlpostering' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const [orig, rev] = await transactions(cid);
    expect(rev!.voucherNumber).toBe(2);
    expect(rev!.kind).toBe('reversal');
    expect(rev!.reverses).toBe(orig!.postId);
    expect(rev!.text).toBe('Modpostering af bilag 1: Fejlpostering');
    expect(rev!.attachment).toEqual(orig!.attachment);
    rev!.lines.forEach((l, i) => {
      expect(l.debit).toBe(orig!.lines[i]!.credit);
      expect(l.credit).toBe(orig!.lines[i]!.debit);
    });
    expect(verifyChain([orig!, rev!])).toBeNull();
    expect((await db.doc(`companies/${cid}/reversals/${postId}`).get()).data()?.['reversedByVoucher']).toBe(2);
  });

  it('refuses to reverse a reversal', async () => {
    const cid = await makeCompany();
    const { postId } = await postOneDraft(OWNER, cid, await makeDraft(cid));
    const rev = await performReverseTransaction(OWNER, { companyId: cid, postId, reason: 'x' });
    await expect(
      performReverseTransaction(OWNER, { companyId: cid, postId: rev.postId, reason: 'y' }),
    ).rejects.toThrow(/kan ikke selv/);
  });
});
