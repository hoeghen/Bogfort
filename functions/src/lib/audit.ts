import type { Transaction as FsTransaction, WriteBatch } from 'firebase-admin/firestore';
import type { AuditAction, AuditEntry } from '../../../src/shared/index.js';
import { db } from './admin.js';

/**
 * Append to the company's audit log as part of the same transaction or batch
 * as the change itself — a change without its log entry (or the reverse) is
 * exactly the gap an audit trail exists to close.
 */
export function writeAudit(
  writer: FsTransaction | WriteBatch,
  companyId: string,
  action: AuditAction,
  by: string,
  target: string | null,
  details: Record<string, unknown> = {},
): void {
  const ref = db.collection(`companies/${companyId}/auditLog`).doc();
  const entry: AuditEntry = { action, by, at: Date.now(), target, details: stripUndefined(details) };
  (writer as FsTransaction).set(ref, entry);
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
}
