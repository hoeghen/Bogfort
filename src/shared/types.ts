/**
 * Firestore document shapes, shared by the app and Cloud Functions so the two
 * cannot drift. All money is integer øre (1 kr = 100 øre); all rates are basis
 * points (25 % = 2500). Dates that are bookkeeping dates (not timestamps) are
 * ISO `YYYY-MM-DD` strings: a posting date has no time zone and must not move
 * across midnight when read on another device.
 */

/** Øre. Always an integer. */
export type Ore = number;

/** `YYYY-MM-DD`. */
export type IsoDate = string;

/**
 * Role matrix. MVP runs single-user (one `owner`), but rules and functions
 * already check roles, so adding an auditor or a treasurer later is a data
 * change, not a schema change.
 *  - owner:      everything, including settings and members
 *  - bookkeeper: kassekladde and posting, no settings
 *  - auditor:    read-only, including the audit log
 */
export type Role = 'owner' | 'bookkeeper' | 'auditor';

export const ROLES: readonly Role[] = ['owner', 'bookkeeper', 'auditor'];

/** `companies/{companyId}` */
export interface Company {
  name: string;
  /** CVR-nummer, 8 digits, or null for foreninger without one. */
  cvr: string | null;
  address: string | null;
  /** 1–12. Most small businesses run calendar years (1). */
  fiscalYearStartMonth: number;
  /** Used when an account has no default contra account of its own. */
  defaultContraAccount: string;
  /** The account VAT is posted to (Skyldig moms). */
  vatAccount: string;
  createdAt: number;
  createdBy: string;
}

/** `companies/{companyId}/members/{uid}` — written by functions only. */
export interface Member {
  uid: string;
  email: string | null;
  roles: Role[];
  addedAt: number;
}

/** `users/{uid}` — written by functions only. */
export interface UserProfile {
  activeCompanyId: string | null;
}

export type AccountType = 'income' | 'expense' | 'asset' | 'liability' | 'equity';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  income: 'Indtægt',
  expense: 'Omkostning',
  asset: 'Aktiv',
  liability: 'Passiv',
  equity: 'Egenkapital',
};

/**
 * Where an expense line lands in the resultatopgørelse. Only meaningful for
 * expense accounts; `direct` costs come off revenue before bruttofortjeneste,
 * `capacity` costs before EBIT.
 */
export type CostGroup = 'direct' | 'capacity' | 'financial';

/** `companies/{companyId}/accounts/{number}` — doc id is the account number. */
export interface Account {
  number: string;
  name: string;
  type: AccountType;
  /** Default VAT code applied when the account is chosen, or null for none. */
  vatCode: string | null;
  /** Contra account suggested when this account is chosen. */
  defaultContraAccount: string | null;
  costGroup: CostGroup | null;
  /** Inactive accounts stay in the chart (history refers to them) but cannot be posted to. */
  active: boolean;
  /**
   * Set on accounts the system itself depends on (the VAT account). Their
   * number and type cannot change and they cannot be deactivated.
   */
  system: 'vat' | null;
}

export type VatDirection = 'output' | 'input' | 'exempt' | 'none';

export const VAT_DIRECTION_LABELS: Record<VatDirection, string> = {
  output: 'Udgående (salgsmoms)',
  input: 'Indgående (købsmoms)',
  exempt: 'Momsfri',
  none: 'Ingen moms',
};

/**
 * `standard` is the only kind phase 1 posts. `reverseCharge` (omvendt
 * betalingspligt / EU-erhvervelse) is in the model so the vat_rules
 * collection does not need migrating when it lands.
 */
export type VatKind = 'standard' | 'reverseCharge';

/** `companies/{companyId}/vat_rules/{code}` — doc id is the code. */
export interface VatRule {
  code: string;
  name: string;
  direction: VatDirection;
  /** Basis points: 2500 = 25 %. */
  rate: number;
  kind: VatKind;
  active: boolean;
}

export type PeriodStatus = 'open' | 'closed';

/** `companies/{companyId}/periods/{startDate}` — one doc per regnskabsår. */
export interface Period {
  startDate: IsoDate;
  endDate: IsoDate;
  /** "2026" or "2025/26" for a broken fiscal year. */
  label: string;
  status: PeriodStatus;
}

/**
 * Which way the money goes for the account the user chose:
 *  - expense: the account is debited, the contra (usually bank) credited
 *  - income:  the account is credited, the contra debited
 */
export type DraftKind = 'expense' | 'income';

export interface AttachmentRef {
  /** Storage object path. */
  path: string;
  name: string;
  contentType: string;
  size: number;
}

/** A posted attachment additionally carries its SHA-256, computed server-side. */
export interface PostedAttachment extends AttachmentRef {
  sha256: string;
}

/**
 * `companies/{companyId}/drafts/{draftId}` — a kassekladde line. The only
 * bookkeeping document a client may write, because it is not yet bookkeeping:
 * it becomes a record only when `postDrafts` turns it into a transaction.
 */
export interface Draft {
  date: IsoDate;
  text: string;
  kind: DraftKind;
  /** Gross amount incl. VAT, positive. */
  amount: Ore;
  account: string;
  contraAccount: string;
  vatCode: string | null;
  attachment: AttachmentRef | null;
  /** True while the file waits in the device's offline queue. */
  attachmentPending: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface PostingLine {
  account: string;
  debit: Ore;
  credit: Ore;
  /** VAT code applied to this line's account, if any. */
  vatCode: string | null;
  /** Set on the generated VAT line: which direction it books. */
  vatDirection: VatDirection | null;
  /** Rate in effect at posting time — later rule edits never rewrite history. */
  vatRate: number | null;
}

/**
 * `companies/{companyId}/transactions/{postId}` — a posted voucher. Server
 * written, never updated, never deleted. Corrections are new transactions
 * with `reverses` set.
 */
export interface Transaction {
  postId: string;
  /** Fortløbende bilagsnummer, unique per company, gapless, starting at 1. */
  voucherNumber: number;
  date: IsoDate;
  periodId: string;
  text: string;
  kind: DraftKind | 'reversal';
  lines: PostingLine[];
  /** Gross amount as entered. */
  amount: Ore;
  attachment: PostedAttachment | null;
  /** postId of the transaction this one cancels. */
  reverses: string | null;
  reversesVoucher: number | null;
  postedAt: number;
  postedBy: string;
  /** SHA-256 of this transaction's canonical content plus `prevHash`. */
  hash: string;
  /** Hash of the previous voucher, or '' for voucher 1. */
  prevHash: string;
}

/** `companies/{companyId}/counters/vouchers` */
export interface VoucherCounter {
  /** Last issued voucher number; 0 before the first posting. */
  last: number;
  /** Hash of the last issued voucher, '' before the first. */
  lastHash: string;
}

/** `companies/{companyId}/reversals/{originalPostId}` — exists once per reversed voucher. */
export interface ReversalMarker {
  reversedBy: string;
  reversedByVoucher: number;
  at: number;
}

export type AuditAction =
  | 'company.created'
  | 'company.updated'
  | 'account.created'
  | 'account.updated'
  | 'vatRule.created'
  | 'vatRule.updated'
  | 'period.created'
  | 'transaction.posted'
  | 'transaction.reversed';

/** `companies/{companyId}/auditLog/{id}` — server written, append only. */
export interface AuditEntry {
  action: AuditAction;
  by: string;
  at: number;
  /** What the entry is about: an account number, a postId, ... */
  target: string | null;
  /** Before/after or other context. Plain JSON. */
  details: Record<string, unknown>;
}
