import type { Transaction as FsTransaction } from 'firebase-admin/firestore';
import type { Member, Role } from '../../../src/shared/index.js';
import { db } from './admin.js';
import { fail } from './errors.js';

export function requireAuth(uid: string | undefined): string {
  if (!uid) fail('unauthenticated', 'Du skal være logget ind.');
  return uid;
}

export function requireString(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || value.trim() === '') fail('invalid-argument', `${field} mangler.`);
  const v = value.trim();
  if (v.length > max) fail('invalid-argument', `${field} er for lang.`);
  return v;
}

export function memberRef(companyId: string, uid: string) {
  return db.doc(`companies/${companyId}/members/${uid}`);
}

/**
 * Check the caller holds one of `roles` in the company. Reads inside the
 * given transaction when there is one, so a role revoked mid-flight cannot
 * slip a write through.
 */
export async function requireRole(
  companyId: unknown,
  uid: string,
  roles: Role[],
  tx?: FsTransaction,
): Promise<Member> {
  if (typeof companyId !== 'string' || !/^[\w-]{1,64}$/.test(companyId)) {
    fail('invalid-argument', 'Ugyldig virksomhed.');
  }
  const ref = memberRef(companyId, uid);
  const snap = tx ? await tx.get(ref) : await ref.get();
  const member = snap.data() as Member | undefined;
  if (!member || !member.roles.some((r) => roles.includes(r))) {
    fail('permission-denied', 'Du har ikke adgang til denne handling.');
  }
  return member;
}
