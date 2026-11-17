import type { Account, Company } from '../../../src/shared/index.js';
import { db } from '../lib/admin.js';
import { requireRole, requireString } from '../lib/access.js';
import { writeAudit } from '../lib/audit.js';
import { fail } from '../lib/errors.js';
import { validateCvr } from './createCompany.js';

export interface UpdateCompanyRequest {
  companyId: string;
  name?: string;
  cvr?: string | null;
  address?: string | null;
  defaultContraAccount?: string;
}

/**
 * Company data and the default contra account. The fiscal-year start month is
 * deliberately not editable once there are periods: moving it would leave
 * existing years overlapping or gapped. Changing it is a year-end task.
 */
export async function performUpdateCompany(uid: string, req: UpdateCompanyRequest): Promise<void> {
  const companyId = req.companyId;
  await db.runTransaction(async (tx) => {
    await requireRole(companyId, uid, ['owner'], tx);
    const ref = db.doc(`companies/${companyId}`);
    const before = (await tx.get(ref)).data() as Company | undefined;
    if (!before) fail('not-found', 'Virksomheden findes ikke.');

    const patch: Partial<Company> = {};
    if (req.name !== undefined) patch.name = requireString(req.name, 'Navn', 120);
    if (req.cvr !== undefined) patch.cvr = validateCvr(req.cvr);
    if (req.address !== undefined) {
      patch.address = typeof req.address === 'string' && req.address.trim() ? req.address.trim().slice(0, 300) : null;
    }
    if (req.defaultContraAccount !== undefined) {
      const acc = (await tx.get(ref.collection('accounts').doc(String(req.defaultContraAccount)))).data() as
        | Account
        | undefined;
      if (!acc || !acc.active || acc.system) fail('invalid-argument', 'Modkontoen findes ikke.');
      patch.defaultContraAccount = acc.number;
    }
    if (Object.keys(patch).length === 0) return;

    tx.update(ref, patch);
    const old: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) old[k] = before[k as keyof Company];
    writeAudit(tx, companyId, 'company.updated', uid, companyId, { before: old, after: patch });
  });
}
