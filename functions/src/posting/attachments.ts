import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  postedAttachmentPath,
  type AttachmentRef,
  type PostedAttachment,
} from '../../../src/shared/index.js';
import { bucket } from '../lib/admin.js';
import { fail } from '../lib/errors.js';
import { sha256Hex } from './hash.js';

/**
 * Copy a draft's bilag to its permanent, client-read-only path, hashing the
 * bytes on the way. The hash is computed here, from what is actually in
 * Storage, not taken from the client — a client-supplied checksum proves
 * nothing.
 */
export async function promoteAttachment(
  companyId: string,
  draftId: string,
  ref: AttachmentRef,
  year: string,
  postId: string,
): Promise<PostedAttachment> {
  const prefix = `bilag/${companyId}/drafts/${draftId}/`;
  if (!ref.path.startsWith(prefix)) fail('invalid-argument', 'Bilaget hører ikke til denne postering.');

  const source = bucket().file(ref.path);
  const [exists] = await source.exists();
  if (!exists) fail('failed-precondition', 'Bilaget er ikke uploadet endnu.');
  const [meta] = await source.getMetadata();
  const contentType = String(meta.contentType ?? '');
  const size = Number(meta.size ?? 0);
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(contentType)) {
    fail('invalid-argument', 'Bilag skal være PDF, PNG eller JPG.');
  }
  if (size <= 0 || size > MAX_ATTACHMENT_BYTES) fail('invalid-argument', 'Bilaget er for stort.');

  const [bytes] = await source.download();
  const sha256 = sha256Hex(bytes);
  const path = postedAttachmentPath(companyId, year, postId, ref.name);
  await bucket()
    .file(path)
    .save(bytes, {
      contentType,
      resumable: false,
      metadata: { metadata: { sha256, postId, originalName: ref.name } },
      // Never overwrite: a permanent bilag path is written exactly once.
      preconditionOpts: { ifGenerationMatch: 0 },
    });
  return { path, name: ref.name, contentType, size: bytes.length, sha256 };
}

export async function deleteQuietly(path: string): Promise<void> {
  try {
    await bucket().file(path).delete({ ignoreNotFound: true });
  } catch {
    // Best effort: an orphaned file costs storage, not correctness.
  }
}
