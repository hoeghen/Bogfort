import { type VatDirection, type VatRule, VAT_DIRECTION_LABELS } from '../../../src/shared/index.js';
import { db } from '../lib/admin.js';
import { requireRole, requireString } from '../lib/access.js';
import { writeAudit } from '../lib/audit.js';
import { fail } from '../lib/errors.js';

export interface UpsertVatRuleRequest {
  companyId: string;
  code: string;
  name: string;
  direction: VatDirection;
  /** Basis points. */
  rate: number;
  active?: boolean;
}

/**
 * Create or edit a VAT rule. Posted vouchers carry the rate they were posted
 * with, so editing a rate changes future postings only. Phase 1 creates
 * standard rules; reverse charge comes with the momsrapport.
 */
export async function performUpsertVatRule(uid: string, req: UpsertVatRuleRequest): Promise<void> {
  const companyId = req.companyId;
  const code = requireString(req.code, 'Kode', 10).toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(code)) fail('invalid-argument', 'Koden må kun indeholde bogstaver og tal.');
  const name = requireString(req.name, 'Navn', 80);
  if (!(req.direction in VAT_DIRECTION_LABELS)) fail('invalid-argument', 'Ugyldig momsretning.');
  const rate = req.direction === 'exempt' || req.direction === 'none' ? 0 : req.rate;
  if (!Number.isInteger(rate) || rate < 0 || rate > 10_000) fail('invalid-argument', 'Ugyldig sats.');
  if ((req.direction === 'output' || req.direction === 'input') && rate === 0) {
    fail('invalid-argument', 'En momssats skal være større end 0 %. Brug "Momsfri" i stedet.');
  }

  await db.runTransaction(async (tx) => {
    await requireRole(companyId, uid, ['owner'], tx);
    const ref = db.doc(`companies/${companyId}/vat_rules/${code}`);
    const before = (await tx.get(ref)).data() as VatRule | undefined;
    const after: VatRule = {
      code,
      name,
      direction: req.direction,
      rate,
      kind: before?.kind ?? 'standard',
      active: req.active ?? before?.active ?? true,
    };
    tx.set(ref, after);
    writeAudit(tx, companyId, before ? 'vatRule.updated' : 'vatRule.created', uid, code, {
      before: before ?? null,
      after,
    });
  });
}
