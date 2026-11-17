import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const CID = 'c1';
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'bogfort-local',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `companies/${CID}`), { name: 'Test' });
    await setDoc(doc(db, `companies/${CID}/members/owner`), { uid: 'owner', roles: ['owner'] });
    await setDoc(doc(db, `companies/${CID}/members/auditor`), { uid: 'auditor', roles: ['auditor'] });
    await setDoc(doc(db, `companies/${CID}/transactions/t1`), { voucherNumber: 1 });
    await setDoc(doc(db, `companies/${CID}/accounts/1000`), { number: '1000' });
    await setDoc(doc(db, `companies/${CID}/auditLog/a1`), { action: 'company.created' });
    await setDoc(doc(db, `users/owner`), { activeCompanyId: CID });
    const st = ctx.storage();
    await uploadBytes(ref(st, `bilag/${CID}/2026/t1.pdf`), new Uint8Array([1]), { contentType: 'application/pdf' });
  });
});

const fs = (uid: string | null): Firestore =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;
const st = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();

function draft(over: Record<string, unknown> = {}) {
  return {
    date: '2026-03-01',
    text: 'Papir',
    kind: 'expense',
    amount: 12500,
    account: '3600',
    contraAccount: '5000',
    vatCode: 'I25',
    attachment: { path: `bilag/${CID}/drafts/d1/f.pdf`, name: 'f.pdf', contentType: 'application/pdf', size: 10 },
    attachmentPending: false,
    createdBy: 'owner',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('company data', () => {
  it('is readable by members only', async () => {
    await assertSucceeds(getDoc(doc(fs('owner'), `companies/${CID}`)));
    await assertSucceeds(getDoc(doc(fs('auditor'), `companies/${CID}/transactions/t1`)));
    await assertFails(getDoc(doc(fs('stranger'), `companies/${CID}`)));
    await assertFails(getDoc(doc(fs(null), `companies/${CID}/accounts/1000`)));
  });

  it('cannot be written by any client, owner included', async () => {
    const db = fs('owner');
    await assertFails(updateDoc(doc(db, `companies/${CID}`), { name: 'x' }));
    await assertFails(setDoc(doc(db, `companies/${CID}/accounts/9000`), { number: '9000' }));
    await assertFails(setDoc(doc(db, `companies/${CID}/members/owner`), { roles: ['owner', 'x'] }));
    await assertFails(setDoc(doc(db, `companies/${CID}/members/friend`), { roles: ['owner'] }));
    await assertFails(setDoc(doc(db, `companies/${CID}/counters/vouchers`), { last: 0 }));
    await assertFails(setDoc(doc(db, `users/owner`), { activeCompanyId: 'other' }));
  });

  it('keeps posted vouchers immutable', async () => {
    const db = fs('owner');
    await assertFails(updateDoc(doc(db, `companies/${CID}/transactions/t1`), { amount: 1 }));
    await assertFails(deleteDoc(doc(db, `companies/${CID}/transactions/t1`)));
    await assertFails(setDoc(doc(db, `companies/${CID}/transactions/t2`), { voucherNumber: 2 }));
  });

  it('shows the audit log to owner and auditor only, and lets nobody write it', async () => {
    await assertSucceeds(getDoc(doc(fs('owner'), `companies/${CID}/auditLog/a1`)));
    await assertSucceeds(getDoc(doc(fs('auditor'), `companies/${CID}/auditLog/a1`)));
    await assertFails(deleteDoc(doc(fs('owner'), `companies/${CID}/auditLog/a1`)));
  });
});

describe('drafts', () => {
  const path = `companies/${CID}/drafts/d1`;

  it('can be created, edited and deleted by the owner', async () => {
    const db = fs('owner');
    await assertSucceeds(setDoc(doc(db, path), draft()));
    await assertSucceeds(updateDoc(doc(db, path), { text: 'Mere papir', updatedAt: 2 }));
    await assertSucceeds(deleteDoc(doc(db, path)));
  });

  it('cannot be written by an auditor or a stranger', async () => {
    await assertFails(setDoc(doc(fs('auditor'), path), draft({ createdBy: 'auditor' })));
    await assertFails(setDoc(doc(fs('stranger'), path), draft({ createdBy: 'stranger' })));
  });

  it('is schema-checked', async () => {
    const db = fs('owner');
    await assertFails(setDoc(doc(db, path), draft({ amount: 12.5 })));
    await assertFails(setDoc(doc(db, path), draft({ amount: -1 })));
    await assertFails(setDoc(doc(db, path), draft({ kind: 'gift' })));
    await assertFails(setDoc(doc(db, path), draft({ extra: true })));
    await assertFails(setDoc(doc(db, path), draft({ createdBy: 'someone-else' })));
    await assertFails(
      setDoc(doc(db, path), draft({ attachment: { path: `bilag/${CID}/2026/t1.pdf`, name: 'f', contentType: 'application/pdf', size: 1 } })),
    );
    await assertFails(
      setDoc(doc(db, path), draft({ attachment: { path: `bilag/other/drafts/d1/f.pdf`, name: 'f', contentType: 'application/pdf', size: 1 } })),
    );
  });

  it('keeps createdBy and createdAt on update', async () => {
    const db = fs('owner');
    await assertSucceeds(setDoc(doc(db, path), draft()));
    await assertFails(updateDoc(doc(db, path), { createdAt: 99 }));
  });
});

describe('bilag storage', () => {
  const pdf = new Uint8Array([37, 80, 68, 70]);

  it('lets the owner upload draft bilag of allowed types and sizes', async () => {
    const s = st('owner');
    await assertSucceeds(uploadBytes(ref(s, `bilag/${CID}/drafts/d1/f.pdf`), pdf, { contentType: 'application/pdf' }));
    await assertSucceeds(deleteObject(ref(s, `bilag/${CID}/drafts/d1/f.pdf`)));
    await assertFails(uploadBytes(ref(s, `bilag/${CID}/drafts/d1/f.exe`), pdf, { contentType: 'application/x-msdownload' }));
  });

  it('refuses uploads from auditors and strangers', async () => {
    await assertFails(uploadBytes(ref(st('auditor'), `bilag/${CID}/drafts/d1/f.pdf`), pdf, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(st('stranger'), `bilag/${CID}/drafts/d1/f.pdf`), pdf, { contentType: 'application/pdf' }));
  });

  it('makes posted bilag readable to members and writable by nobody', async () => {
    await assertSucceeds(getBytes(ref(st('auditor'), `bilag/${CID}/2026/t1.pdf`)));
    await assertFails(getBytes(ref(st('stranger'), `bilag/${CID}/2026/t1.pdf`)));
    await assertFails(uploadBytes(ref(st('owner'), `bilag/${CID}/2026/t1.pdf`), pdf, { contentType: 'application/pdf' }));
    await assertFails(deleteObject(ref(st('owner'), `bilag/${CID}/2026/t1.pdf`)));
  });
});
