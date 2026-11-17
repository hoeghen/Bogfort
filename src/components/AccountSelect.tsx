import { ACCOUNT_TYPE_LABELS, type Account, type AccountType } from '../shared';
import { Select } from './ui';

const ORDER: AccountType[] = ['income', 'expense', 'asset', 'liability', 'equity'];

/** Postable accounts grouped by type; system accounts (VAT) and inactive ones are left out. */
export function AccountSelect({
  accounts,
  value,
  onChange,
  exclude,
  placeholder = 'Vælg konto',
  id,
}: {
  accounts: Account[];
  value: string;
  onChange: (v: string) => void;
  exclude?: string;
  placeholder?: string;
  id?: string;
}) {
  const usable = accounts.filter((a) => a.active && !a.system && a.number !== exclude);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {ORDER.map((type) => {
        const group = usable.filter((a) => a.type === type);
        if (group.length === 0) return null;
        return (
          <optgroup key={type} label={ACCOUNT_TYPE_LABELS[type]}>
            {group.map((a) => (
              <option key={a.number} value={a.number}>
                {a.number} · {a.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </Select>
  );
}
