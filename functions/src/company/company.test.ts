import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNTS, DEFAULT_VAT_RULES, type Account, type AuditEntry } from '../../../src/shared/index.js';
import { db, makeCompany, OWNER, resetEmulators } from '../test/harness.js';
import { performCreateCompany } from './createCompany.js';
import { performUpdateCompany } from './updateCompany.js';
import { performUpsertAccount } from '../settings/upsertAccount.js';
import { performUpsertVatRule } from '../settings/upsertVatRule.js';

beforeEach(resetEmulators);

const audit = async (cid: string) =>
  (await db.collection(`companies/${cid}/auditLog`).orderBy('at').get()).docs.map((d) => d.data() as AuditEntry);

describe('createCompany', () => {
  it('seeds the owner, chart, VAT rules, period and counter', async () => {
    const cid = await makeCompany();
    const accounts = await db.collection(`companies/${cid}/accounts`).get();
    const rules = await db.collection(`companies/${cid}/vat_rules`).get();
    expect(accounts.size).toBe(DEFAULT_ACCOUNTS.length);
    expect(rules.size).toBe(DEFAULT_VAT_RULES.length);
    expect((await db.doc(`companies/${cid}/members/${OWNER}`).get()).data()?.['roles']).toEqual(['owner']);
    expect((await db.doc(`companies/${cid}/counters/vouchers`).get()).data()).toEqual({ last: 0, lastHash: '' });
    expect((await db.collection(`companies/${cid}/periods`).get()).size).toBe(1);
    expect((await db.doc(`users/${OWNER}`).get()).data()).toEqual({ activeCompanyId: cid });
    expect((await audit(cid)).map((a) => a.action)).toEqual(['company.created']);
  });

  it('allows one company per user in the MVP', async () => {
    await makeCompany();
    await expect(performCreateCompany(OWNER, null, { name: 'Endnu en' })).rejects.toThrow(/allerede/);
  });

  it('validates CVR', async () => {
    await expect(performCreateCompany(OWNER, null, { name: 'X', cvr: '123' })).rejects.toThrow(/8 cifre/);
  });
});

describe('settings', () => {
  it('only lets the owner change company data, and logs it', async () => {
    const cid = await makeCompany();
    await expect(performUpdateCompany('stranger', { companyId: cid, name: 'Hack' })).rejects.toThrow(/adgang/);
    await performUpdateCompany(OWNER, { companyId: cid, name: 'Nyt navn', defaultContraAccount: '5010' });
    const c = (await db.doc(`companies/${cid}`).get()).data()!;
    expect(c['name']).toBe('Nyt navn');
    expect(c['defaultContraAccount']).toBe('5010');
    expect((await audit(cid)).at(-1)?.action).toBe('company.updated');
  });

  it('creates accounts and keeps number and type fixed on edit', async () => {
    const cid = await makeCompany();
    await performUpsertAccount(OWNER, {
      companyId: cid,
      number: '3700',
      name: 'Telefon',
      type: 'expense',
      vatCode: 'I25',
      defaultContraAccount: null,
    });
    await performUpsertAccount(OWNER, {
      companyId: cid,
      number: '3700',
      name: 'Telefon & internet',
      type: 'income',
      vatCode: null,
      defaultContraAccount: '5010',
    });
    const a = (await db.doc(`companies/${cid}/accounts/3700`).get()).data() as Account;
    expect(a).toMatchObject({ name: 'Telefon & internet', type: 'expense', vatCode: null, defaultContraAccount: '5010' });
    expect((await audit(cid)).slice(-2).map((e) => e.action)).toEqual(['account.created', 'account.updated']);
  });

  it('refuses to deactivate the VAT account or give it VAT', async () => {
    const cid = await makeCompany();
    const base = { companyId: cid, number: '6000', name: 'Moms', vatCode: null, defaultContraAccount: null };
    await expect(performUpsertAccount(OWNER, { ...base, active: false })).rejects.toThrow(/Systemkonti/);
    await expect(performUpsertAccount(OWNER, { ...base, vatCode: 'I25' })).rejects.toThrow(/selv have moms/);
  });

  it('rejects unknown VAT codes and contra accounts', async () => {
    const cid = await makeCompany();
    const base = { companyId: cid, number: '3800', name: 'X', type: 'expense' as const, defaultContraAccount: null };
    await expect(performUpsertAccount(OWNER, { ...base, vatCode: 'NOPE' })).rejects.toThrow(/Momsreglen/);
    await expect(
      performUpsertAccount(OWNER, { ...base, vatCode: null, defaultContraAccount: '9999' }),
    ).rejects.toThrow(/Modkontoen/);
  });

  it('creates VAT rules and refuses a 0 % taxed rate', async () => {
    const cid = await makeCompany();
    await performUpsertVatRule(OWNER, { companyId: cid, code: 'i12', name: 'Købsmoms 12,5 %', direction: 'input', rate: 1250 });
    expect((await db.doc(`companies/${cid}/vat_rules/I12`).get()).data()).toMatchObject({ rate: 1250, kind: 'standard' });
    await expect(
      performUpsertVatRule(OWNER, { companyId: cid, code: 'X', name: 'X', direction: 'output', rate: 0 }),
    ).rejects.toThrow(/Momsfri/);
  });
});
