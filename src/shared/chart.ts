import type { Account, Company, VatRule } from './types.js';

/**
 * The standard chart and VAT rules every new company starts from (spec §3).
 * Seeded once by `createCompany`; after that they belong to the company and
 * are changed through the settings menu.
 */
export const DEFAULT_VAT_RULES: VatRule[] = [
  { code: 'U25', name: 'Udgående moms 25 %', direction: 'output', rate: 2500, kind: 'standard', active: true },
  { code: 'I25', name: 'Indgående moms 25 %', direction: 'input', rate: 2500, kind: 'standard', active: true },
  { code: 'MF', name: 'Momsfri', direction: 'exempt', rate: 0, kind: 'standard', active: true },
];

function account(
  number: string,
  name: string,
  type: Account['type'],
  vatCode: string | null,
  extra: Partial<Account> = {},
): Account {
  return {
    number,
    name,
    type,
    vatCode,
    defaultContraAccount: null,
    costGroup: null,
    active: true,
    system: null,
    ...extra,
  };
}

export const DEFAULT_ACCOUNTS: Account[] = [
  account('1000', 'Salg af varer/ydelser (momspligtigt)', 'income', 'U25'),
  account('1005', 'Momsfrit salg / Kontingenter', 'income', 'MF'),
  account('2000', 'Varekøb', 'expense', 'I25', { costGroup: 'direct' }),
  account('3000', 'Lokaleomkostninger & El', 'expense', 'I25', { costGroup: 'capacity' }),
  account('3600', 'Kontorartikler & Software', 'expense', 'I25', { costGroup: 'capacity' }),
  account('5000', 'Bank / Driftskonto', 'asset', null),
  account('5010', 'Kasse / Kontant', 'asset', null),
  account('6000', 'Skyldig moms (samlekonto)', 'liability', null, { system: 'vat' }),
  account('6010', 'Udestående tilgodehavender', 'asset', null),
  account('6020', 'Kreditorer / Leverandørgæld', 'liability', null),
];

export const DEFAULT_COMPANY_SETTINGS: Pick<Company, 'defaultContraAccount' | 'vatAccount'> = {
  defaultContraAccount: '5000',
  vatAccount: '6000',
};
