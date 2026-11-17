import {
  DEFAULT_ACCOUNTS,
  DEFAULT_COMPANY_SETTINGS,
  DEFAULT_VAT_RULES,
  fiscalYearFor,
  todayIso,
  type Company,
  type Member,
  type UserProfile,
  type VoucherCounter,
} from '../../../src/shared/index.js';
import { db } from '../lib/admin.js';
import { requireString } from '../lib/access.js';
import { writeAudit } from '../lib/audit.js';
import { fail } from '../lib/errors.js';

export interface CreateCompanyRequest {
  name: string;
  cvr?: string | null;
  address?: string | null;
  fiscalYearStartMonth?: number;
}

export function validateCvr(cvr: unknown): string | null {
  if (cvr === undefined || cvr === null || cvr === '') return null;
  if (typeof cvr !== 'string') fail('invalid-argument', 'Ugyldigt CVR-nummer.');
  const digits = cvr.replace(/\s/g, '');
  if (!/^\d{8}$/.test(digits)) fail('invalid-argument', 'CVR-nummeret skal være 8 cifre.');
  return digits;
}

export function validateStartMonth(m: unknown): number {
  if (m === undefined) return 1;
  if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 12) {
    fail('invalid-argument', 'Regnskabsåret skal starte i en måned mellem 1 og 12.');
  }
  return m;
}

/**
 * Create a company with its owner, the standard chart, VAT rules and the
 * current regnskabsår — all in one batch, so a company never exists half
 * seeded. Members and roles are only ever written here (and by future member
 * functions), never by clients: a client that could write its own roles could
 * grant itself anything.
 *
 * MVP is single-user: one company per account.
 */
export async function performCreateCompany(
  uid: string,
  email: string | null,
  req: CreateCompanyRequest,
): Promise<{ companyId: string }> {
  const name = requireString(req.name, 'Navn', 120);
  const cvr = validateCvr(req.cvr);
  const address = typeof req.address === 'string' && req.address.trim() ? req.address.trim().slice(0, 300) : null;
  const fiscalYearStartMonth = validateStartMonth(req.fiscalYearStartMonth);

  const userRef = db.doc(`users/${uid}`);
  const companyRef = db.collection('companies').doc();
  const companyId = companyRef.id;
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const profile = (await tx.get(userRef)).data() as UserProfile | undefined;
    if (profile?.activeCompanyId) fail('already-exists', 'Du har allerede en virksomhed.');

    const company: Company = {
      name,
      cvr,
      address,
      fiscalYearStartMonth,
      ...DEFAULT_COMPANY_SETTINGS,
      createdAt: now,
      createdBy: uid,
    };
    const member: Member = { uid, email, roles: ['owner'], addedAt: now };
    const counter: VoucherCounter = { last: 0, lastHash: '' };
    const period = fiscalYearFor(todayIso(), fiscalYearStartMonth);

    tx.set(companyRef, company);
    tx.set(companyRef.collection('members').doc(uid), member);
    tx.set(companyRef.collection('counters').doc('vouchers'), counter);
    tx.set(companyRef.collection('periods').doc(period.startDate), period);
    for (const a of DEFAULT_ACCOUNTS) tx.set(companyRef.collection('accounts').doc(a.number), a);
    for (const v of DEFAULT_VAT_RULES) tx.set(companyRef.collection('vat_rules').doc(v.code), v);
    tx.set(userRef, { activeCompanyId: companyId } satisfies UserProfile);
    writeAudit(tx, companyId, 'company.created', uid, companyId, { name, cvr, fiscalYearStartMonth });
  });

  return { companyId };
}
