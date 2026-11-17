/**
 * The app's data layer. Components never touch the Firestore SDK directly.
 *
 * Reads are live subscriptions. The only direct write is the kassekladde
 * (drafts); everything else — posting, reversing, settings — goes through a
 * Cloud Function that validates and logs it.
 */
import {
  collection,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref } from 'firebase/storage';
import type {
  Account,
  AccountType,
  AuditEntry,
  Company,
  CostGroup,
  Draft,
  Period,
  ReversalMarker,
  Transaction,
  UserProfile,
  VatDirection,
  VatRule,
} from '../shared';
import { db, functions, storage } from './firebase';
import { useLiveDoc, useLiveQuery } from './hooks';

export type WithId<T> = T & { id: string };

const c = (cid: string, sub: string) => collection(db, `companies/${cid}/${sub}`);

export function useProfile(uid: string | null) {
  return useLiveDoc<UserProfile>(uid ? doc(db, `users/${uid}`) : null, `user:${uid}`);
}

export function useCompanyDoc(cid: string | null) {
  return useLiveDoc<Company>(cid ? doc(db, `companies/${cid}`) : null, `company:${cid}`);
}

export function useAccounts(cid: string | null) {
  return useLiveQuery<Account>(cid ? query(c(cid, 'accounts'), orderBy('number')) : null, `accounts:${cid}`);
}

export function useVatRules(cid: string | null) {
  return useLiveQuery<VatRule>(cid ? query(c(cid, 'vat_rules'), orderBy('code')) : null, `vat:${cid}`);
}

export function useDrafts(cid: string | null) {
  return useLiveQuery<Draft>(cid ? query(c(cid, 'drafts'), orderBy('date', 'desc')) : null, `drafts:${cid}`);
}

export function useTransactions(cid: string | null, max: number) {
  return useLiveQuery<Transaction>(
    cid ? query(c(cid, 'transactions'), orderBy('voucherNumber', 'desc'), limit(max)) : null,
    `tx:${cid}:${max}`,
  );
}

export function useReversals(cid: string | null) {
  return useLiveQuery<ReversalMarker>(cid ? c(cid, 'reversals') : null, `rev:${cid}`);
}

export function usePeriods(cid: string | null) {
  return useLiveQuery<Period>(cid ? query(c(cid, 'periods'), orderBy('startDate', 'desc')) : null, `periods:${cid}`);
}

export function useAuditLog(cid: string | null, max: number) {
  return useLiveQuery<AuditEntry>(
    cid ? query(c(cid, 'auditLog'), orderBy('at', 'desc'), limit(max)) : null,
    `audit:${cid}:${max}`,
  );
}

// ---- Kassekladde -----------------------------------------------------------

export function newDraftId(cid: string): string {
  return doc(c(cid, 'drafts')).id;
}

/**
 * Save a kassekladde line. Not awaited by callers: with the persistent cache
 * the write lands locally at once and syncs whenever there is a connection.
 */
export function saveDraft(cid: string, id: string, draft: Draft): Promise<void> {
  return setDoc(doc(db, `companies/${cid}/drafts/${id}`), draft);
}

export function deleteDraft(cid: string, id: string): Promise<void> {
  return deleteDoc(doc(db, `companies/${cid}/drafts/${id}`));
}

// ---- Cloud Functions -------------------------------------------------------

function call<Req, Res>(name: string) {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (req: Req): Promise<Res> => (await fn(req)).data;
}

export const createCompany = call<
  { name: string; cvr: string | null; address: string | null; fiscalYearStartMonth: number },
  { companyId: string }
>('createCompany');

export const updateCompany = call<
  { companyId: string; name?: string; cvr?: string | null; address?: string | null; defaultContraAccount?: string },
  void
>('updateCompany');

export const upsertAccount = call<
  {
    companyId: string;
    number: string;
    name: string;
    type?: AccountType;
    vatCode: string | null;
    defaultContraAccount: string | null;
    costGroup?: CostGroup | null;
    active?: boolean;
  },
  void
>('upsertAccount');

export const upsertVatRule = call<
  { companyId: string; code: string; name: string; direction: VatDirection; rate: number; active?: boolean },
  void
>('upsertVatRule');

export interface PostDraftsResult {
  posted: { draftId: string; postId: string; voucherNumber: number }[];
  failed: { draftId: string; message: string }[];
}

export const postDrafts = call<{ companyId: string; draftIds: string[] }, PostDraftsResult>('postDrafts');

export const reverseTransaction = call<
  { companyId: string; postId: string; reason: string },
  { postId: string; voucherNumber: number }
>('reverseTransaction');

/** Callable errors carry a Danish message from the function; anything else gets a generic one. */
export function errorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e.code === 'functions/unavailable' || e.code === 'functions/deadline-exceeded') {
    return 'Ingen forbindelse til serveren. Prøv igen, når du er online.';
  }
  if (e.code?.startsWith('functions/') && e.code !== 'functions/internal' && e.message) return e.message;
  return 'Noget gik galt. Prøv igen.';
}

export function attachmentUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}
