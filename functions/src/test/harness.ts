import { bucket, db } from '../lib/admin.js';
import { performCreateCompany } from '../company/createCompany.js';
import { draftAttachmentPath, todayIso, type Draft } from '../../../src/shared/index.js';

export const PROJECT_ID = 'bogfort-local';
export const OWNER = 'owner-uid';

export { db };

/** Wipe Firestore and Storage between tests via the emulators' own endpoints. */
export async function resetEmulators(): Promise<void> {
  const fs = process.env['FIRESTORE_EMULATOR_HOST'];
  const res = await fetch(`http://${fs}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`reset firestore failed: ${res.status}`);
  const [files] = await bucket().getFiles();
  await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
}

export async function makeCompany(uid = OWNER): Promise<string> {
  const { companyId } = await performCreateCompany(uid, `${uid}@example.com`, { name: 'Test ApS', cvr: '12345678' });
  return companyId;
}

export const PDF_BYTES = Buffer.from('%PDF-1.4\n% bogført test\n');

/** Create a draft with an uploaded bilag, the way the app does. */
export async function makeDraft(
  companyId: string,
  overrides: Partial<Draft> = {},
  opts: { upload?: boolean; bytes?: Buffer; contentType?: string } = {},
): Promise<string> {
  const ref = db.collection(`companies/${companyId}/drafts`).doc();
  const path = draftAttachmentPath(companyId, ref.id, 'faktura.pdf');
  const bytes = opts.bytes ?? PDF_BYTES;
  if (opts.upload !== false) {
    await bucket().file(path).save(bytes, { contentType: opts.contentType ?? 'application/pdf', resumable: false });
  }
  const now = Date.now();
  const draft: Draft = {
    date: todayIso(),
    text: 'Printerpapir',
    kind: 'expense',
    amount: 125000,
    account: '3600',
    contraAccount: '5000',
    vatCode: 'I25',
    attachment: { path, name: 'faktura.pdf', contentType: opts.contentType ?? 'application/pdf', size: bytes.length },
    attachmentPending: false,
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await ref.set(draft);
  return ref.id;
}
