import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { doc } from 'firebase/firestore';
import type { Account, Company, Member, Role, VatRule } from '../shared';
import { useAccounts, useCompanyDoc, useVatRules, type WithId } from './data';
import { db } from './firebase';
import { useLiveDoc } from './hooks';
import { Spinner } from '../components/ui';

export interface CompanyCtx {
  uid: string;
  companyId: string;
  company: Company;
  roles: Role[];
  can: { book: boolean; configure: boolean };
  accounts: WithId<Account>[];
  vatRules: WithId<VatRule>[];
  account: (n: string | null | undefined) => Account | undefined;
  vatRule: (c: string | null | undefined) => VatRule | undefined;
}

const Ctx = createContext<CompanyCtx | null>(null);

export function CompanyProvider({ uid, companyId, children }: { uid: string; companyId: string; children: ReactNode }) {
  const company = useCompanyDoc(companyId);
  const accounts = useAccounts(companyId);
  const vatRules = useVatRules(companyId);
  const member = useLiveDoc<Member>(doc(db, `companies/${companyId}/members/${uid}`), `member:${companyId}:${uid}`);

  const value = useMemo<CompanyCtx | null>(() => {
    if (!company.data || !member.data) return null;
    const byNumber = new Map(accounts.data.map((a) => [a.number, a]));
    const byCode = new Map(vatRules.data.map((v) => [v.code, v]));
    const roles = member.data.roles;
    return {
      uid,
      companyId,
      company: company.data,
      roles,
      can: {
        book: roles.includes('owner') || roles.includes('bookkeeper'),
        configure: roles.includes('owner'),
      },
      accounts: accounts.data,
      vatRules: vatRules.data,
      account: (n) => (n ? byNumber.get(n) : undefined),
      vatRule: (c) => (c ? byCode.get(c) : undefined),
    };
  }, [uid, companyId, company.data, member.data, accounts.data, vatRules.data]);

  if (!value) return <Spinner />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompany(): CompanyCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCompany outside CompanyProvider');
  return v;
}
