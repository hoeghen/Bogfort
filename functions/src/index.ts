import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { requireAuth } from './lib/access.js';
import { toHttpsError } from './lib/errors.js';
import { performCreateCompany, type CreateCompanyRequest } from './company/createCompany.js';
import { performUpdateCompany, type UpdateCompanyRequest } from './company/updateCompany.js';
import { performUpsertAccount, type UpsertAccountRequest } from './settings/upsertAccount.js';
import { performUpsertVatRule, type UpsertVatRuleRequest } from './settings/upsertVatRule.js';
import { performPostDrafts, type PostDraftsRequest, type PostDraftsResult } from './posting/postDrafts.js';
import { performReverseTransaction, type ReverseTransactionRequest } from './posting/reverseTransaction.js';

// Danish bookkeeping data stays in the EU.
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

function callable<Req, Res>(handler: (uid: string, data: Req, req: CallableRequest<Req>) => Promise<Res>) {
  return onCall<Req>(async (req) => {
    const uid = requireAuth(req.auth?.uid);
    try {
      return await handler(uid, req.data, req);
    } catch (err) {
      throw toHttpsError(err);
    }
  });
}

export const createCompany = callable<CreateCompanyRequest, { companyId: string }>((uid, data, req) =>
  performCreateCompany(uid, (req.auth?.token.email as string | undefined) ?? null, data),
);
export const updateCompany = callable<UpdateCompanyRequest, void>(performUpdateCompany);
export const upsertAccount = callable<UpsertAccountRequest, void>(performUpsertAccount);
export const upsertVatRule = callable<UpsertVatRuleRequest, void>(performUpsertVatRule);
export const postDrafts = callable<PostDraftsRequest, PostDraftsResult>(performPostDrafts);
export const reverseTransaction = callable<ReverseTransactionRequest, { postId: string; voucherNumber: number }>(
  performReverseTransaction,
);
