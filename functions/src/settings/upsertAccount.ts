import {
  type Account,
  type AccountType,
  type CostGroup,
  ACCOUNT_TYPE_LABELS,
} from '../../../src/shared/index.js';
import { db } from '../lib/admin.js';
import { requireRole, requireString } from '../lib/access.js';
import { writeAudit } from '../lib/audit.js';
import { fail } from '../lib/errors.js';

export interface UpsertAccountRequest {
  companyId: string;
  number: string;
  name: string;
  /** Only honoured on create — an account's type is fixed once it exists. */
  type?: AccountType;
  vatCode: string | null;
  defaultContraAccount: string | null;
  costGroup?: CostGroup | null;
  active?: boolean;
}

const COST_GROUPS: CostGroup[] = ['direct', 'capacity', 'financial'];

/**
 * Create or edit an account in the chart.
 *
 * Number and type are immutable after creation: posted vouchers refer to the
 * number, and reports classify by type, so changing either would rewrite
 * history that bogføringsloven says must stay as it was. Name, default VAT and
 * default contra only affect future postings, which is exactly what UC-5 asks.
 * Accounts are never deleted, only deactivated.
 */
export async function performUpsertAccount(uid: string, req: UpsertAccountRequest): Promise<void> {
  const companyId = req.companyId;
  const number = requireString(req.number, 'Kontonummer', 10);
  if (!/^\d{3,6}$/.test(number)) fail('invalid-argument', 'Kontonummeret skal være 3–6 cifre.');
  const name = requireString(req.name, 'Kontonavn', 120);

  await db.runTransaction(async (tx) => {
    await requireRole(companyId, uid, ['owner'], tx);
    const companyRef = db.doc(`companies/${companyId}`);
    const ref = companyRef.collection('accounts').doc(number);
    const before = (await tx.get(ref)).data() as Account | undefined;

    const type = before ? before.type : req.type;
    if (!type || !(type in ACCOUNT_TYPE_LABELS)) fail('invalid-argument', 'Vælg en kontotype.');

    let vatCode: string | null = null;
    if (req.vatCode) {
      const rule = await tx.get(companyRef.collection('vat_rules').doc(String(req.vatCode)));
      if (!rule.exists) fail('invalid-argument', 'Momsreglen findes ikke.');
      vatCode = rule.id;
    }
    let defaultContraAccount: string | null = null;
    if (req.defaultContraAccount) {
      if (req.defaultContraAccount === number) fail('invalid-argument', 'En konto kan ikke være sin egen modkonto.');
      const contra = (await tx.get(companyRef.collection('accounts').doc(String(req.defaultContraAccount)))).data() as
        | Account
        | undefined;
      if (!contra || contra.system) fail('invalid-argument', 'Modkontoen findes ikke.');
      defaultContraAccount = contra.number;
    }
    const costGroup = type === 'expense' ? (COST_GROUPS.includes(req.costGroup as CostGroup) ? req.costGroup! : 'capacity') : null;
    const active = req.active ?? before?.active ?? true;

    if (before?.system) {
      if (!active) fail('failed-precondition', 'Systemkonti kan ikke deaktiveres.');
      if (vatCode) fail('failed-precondition', 'Momskontoen kan ikke selv have moms.');
    }

    const after: Account = {
      number,
      name,
      type,
      vatCode,
      defaultContraAccount,
      costGroup,
      active,
      system: before?.system ?? null,
    };
    tx.set(ref, after);
    writeAudit(tx, companyId, before ? 'account.updated' : 'account.created', uid, number, {
      before: before ?? null,
      after,
    });
  });
}
