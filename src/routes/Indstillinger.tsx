import { useState, type FormEvent } from 'react';
import {
  ACCOUNT_TYPE_LABELS,
  VAT_DIRECTION_LABELS,
  formatRate,
  type Account,
  type AccountType,
  type AuditAction,
  type CostGroup,
  type VatDirection,
  type VatRule,
} from '../shared';
import { AccountSelect } from '../components/AccountSelect';
import { Button, Card, Field, Input, Notice, Select, cx } from '../components/ui';
import { signOut } from '../lib/auth';
import { auth } from '../lib/firebase';
import { useCompany } from '../lib/company';
import {
  errorMessage,
  updateCompany,
  upsertAccount,
  upsertVatRule,
  useAuditLog,
  usePeriods,
} from '../lib/data';
import { useOnline } from '../lib/hooks';

type Tab = 'company' | 'accounts' | 'vat' | 'years' | 'log';

const TABS: { id: Tab; label: string }[] = [
  { id: 'company', label: 'Virksomhed' },
  { id: 'accounts', label: 'Kontoplan' },
  { id: 'vat', label: 'Moms' },
  { id: 'years', label: 'Regnskabsår' },
  { id: 'log', label: 'Revisionsspor' },
];

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, ok = 'Gemt.') {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      return true;
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, run, setMsg };
}

function CompanySettings() {
  const { companyId, company, accounts, can } = useCompany();
  const [name, setName] = useState(company.name);
  const [cvr, setCvr] = useState(company.cvr ?? '');
  const [address, setAddress] = useState(company.address ?? '');
  const [contra, setContra] = useState(company.defaultContraAccount);
  const { busy, msg, run } = useSubmit();
  const online = useOnline();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(() =>
      updateCompany({ companyId, name, cvr: cvr.trim() || null, address: address.trim() || null, defaultContraAccount: contra }),
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Navn">
            <Input value={name} onChange={(e) => setName(e.target.value)} required disabled={!can.configure} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CVR-nummer">
              <Input inputMode="numeric" value={cvr} onChange={(e) => setCvr(e.target.value)} disabled={!can.configure} />
            </Field>
            <Field label="Standard modkonto" hint="Foreslås, når en konto ikke har sin egen.">
              <AccountSelect accounts={accounts} value={contra} onChange={setContra} />
            </Field>
          </div>
          <Field label="Adresse">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} disabled={!can.configure} />
          </Field>
          <p className="text-xs text-slate-500">
            Regnskabsåret starter den 1. i måned {company.fiscalYearStartMonth}. Det ændres ved årsafslutning.
          </p>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {can.configure && (
            <Button type="submit" disabled={busy || !online}>
              Gem
            </Button>
          )}
        </form>
      </Card>
      <Card className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <div className="text-xs text-slate-500">Logget ind som</div>
          <div className="truncate">{auth.currentUser?.email}</div>
        </div>
        <Button variant="secondary" onClick={() => void signOut()}>
          Log ud
        </Button>
      </Card>
    </div>
  );
}

function AccountEditor({ initial, onClose }: { initial: Account | null; onClose: () => void }) {
  const { companyId, accounts, vatRules } = useCompany();
  const isNew = initial === null;
  const [number, setNumber] = useState(initial?.number ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<AccountType>(initial?.type ?? 'expense');
  const [vatCode, setVatCode] = useState(initial?.vatCode ?? '');
  const [contra, setContra] = useState(initial?.defaultContraAccount ?? '');
  const [costGroup, setCostGroup] = useState<CostGroup>(initial?.costGroup ?? 'capacity');
  const [active, setActive] = useState(initial?.active ?? true);
  const { busy, msg, run } = useSubmit();
  const isSystem = !!initial?.system;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() =>
      upsertAccount({
        companyId,
        number,
        name,
        type,
        vatCode: vatCode || null,
        defaultContraAccount: contra || null,
        costGroup: type === 'expense' ? costGroup : null,
        active,
      }),
    );
    if (ok) onClose();
  }

  return (
    <Card className="border-emerald-200">
      <form onSubmit={submit} className="space-y-4">
        <h3 className="font-semibold">{isNew ? 'Ny konto' : `Ret konto ${initial.number}`}</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Kontonummer">
            <Input inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} disabled={!isNew} required />
          </Field>
          <Field label="Kontonavn" className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Kontotype" hint={isNew ? 'Kan ikke ændres senere.' : undefined}>
            <Select value={type} onChange={(e) => setType(e.target.value as AccountType)} disabled={!isNew}>
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {!isSystem && (
            <Field label="Standard moms">
              <Select value={vatCode} onChange={(e) => setVatCode(e.target.value)}>
                <option value="">Ingen moms</option>
                {vatRules.map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!isSystem && (
            <Field label="Standard modkonto">
              <AccountSelect accounts={accounts} value={contra} onChange={setContra} exclude={number} placeholder="Virksomhedens standard" />
            </Field>
          )}
          {type === 'expense' && (
            <Field label="Omkostningstype" hint="Bruges i resultatopgørelsen.">
              <Select value={costGroup} onChange={(e) => setCostGroup(e.target.value as CostGroup)}>
                <option value="direct">Direkte omkostning</option>
                <option value="capacity">Kapacitetsomkostning</option>
                <option value="financial">Finansiel omkostning</option>
              </Select>
            </Field>
          )}
        </div>
        {!isSystem && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Aktiv (kan vælges i kassekladden)
          </label>
        )}
        {msg?.tone === 'error' && <Notice tone="error">{msg.text}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Gem
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuller
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AccountsSettings() {
  const { accounts, vatRule, can } = useCompany();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  return (
    <div className="space-y-3">
      {editing && <AccountEditor key={editing === 'new' ? 'new' : editing.number} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {can.configure && !editing && (
        <Button variant="secondary" onClick={() => setEditing('new')}>
          Ny konto
        </Button>
      )}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {accounts.map((a) => (
          <li key={a.number}>
            <button
              type="button"
              disabled={!can.configure}
              onClick={() => setEditing(a)}
              className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50', !a.active && 'text-slate-400')}
            >
              <span className="num w-12 shrink-0 font-medium">{a.number}</span>
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="hidden text-xs text-slate-500 sm:inline">{ACCOUNT_TYPE_LABELS[a.type]}</span>
              <span className="w-28 shrink-0 truncate text-right text-xs text-slate-500">
                {a.system === 'vat' ? 'Automatisk' : (vatRule(a.vatCode)?.name ?? 'Ingen moms')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function parseRate(s: string): number | null {
  const n = Number(s.replace(',', '.').replace('%', '').trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

function VatEditor({ initial, onClose }: { initial: VatRule | null; onClose: () => void }) {
  const { companyId } = useCompany();
  const isNew = initial === null;
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [direction, setDirection] = useState<VatDirection>(initial?.direction ?? 'input');
  const [rate, setRate] = useState(initial ? String(initial.rate / 100).replace('.', ',') : '25');
  const [active, setActive] = useState(initial?.active ?? true);
  const { busy, msg, run, setMsg } = useSubmit();
  const taxed = direction === 'input' || direction === 'output';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const bp = taxed ? parseRate(rate) : 0;
    if (bp === null) return setMsg({ tone: 'error', text: 'Skriv satsen i procent, fx 25.' });
    const ok = await run(() => upsertVatRule({ companyId, code, name, direction, rate: bp, active }));
    if (ok) onClose();
  }

  return (
    <Card className="border-emerald-200">
      <form onSubmit={submit} className="space-y-4">
        <h3 className="font-semibold">{isNew ? 'Ny momsregel' : `Ret ${initial.code}`}</h3>
        {!isNew && (
          <Notice>En ændret sats gælder kun nye posteringer. Bogførte posteringer beholder den sats, de blev bogført med.</Notice>
        )}
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Kode">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={!isNew} required maxLength={10} />
          </Field>
          <Field label="Navn" className="sm:col-span-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Type" className="sm:col-span-2">
            <Select value={direction} onChange={(e) => setDirection(e.target.value as VatDirection)}>
              {Object.entries(VAT_DIRECTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {taxed && (
            <Field label="Sats (%)">
              <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Aktiv
        </label>
        {msg?.tone === 'error' && <Notice tone="error">{msg.text}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Gem
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuller
          </Button>
        </div>
      </form>
    </Card>
  );
}

function VatSettings() {
  const { vatRules, can } = useCompany();
  const [editing, setEditing] = useState<VatRule | 'new' | null>(null);
  return (
    <div className="space-y-3">
      {editing && <VatEditor key={editing === 'new' ? 'new' : editing.code} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {can.configure && !editing && (
        <Button variant="secondary" onClick={() => setEditing('new')}>
          Ny momsregel
        </Button>
      )}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {vatRules.map((v) => (
          <li key={v.code}>
            <button
              type="button"
              disabled={!can.configure}
              onClick={() => setEditing(v)}
              className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50', !v.active && 'text-slate-400')}
            >
              <span className="w-12 shrink-0 font-medium">{v.code}</span>
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              <span className="text-xs text-slate-500">
                {VAT_DIRECTION_LABELS[v.direction]}
                {v.rate > 0 && ` · ${formatRate(v.rate)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function YearsSettings() {
  const { companyId } = useCompany();
  const periods = usePeriods(companyId);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {periods.data.map((p) => (
          <li key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="font-medium">{p.label}</span>
            <span className="text-xs text-slate-500">
              {p.startDate} – {p.endDate}
            </span>
            <span className={cx('rounded-full px-2 py-0.5 text-xs', p.status === 'open' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600')}>
              {p.status === 'open' ? 'Åben' : 'Lukket'}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        Et nyt regnskabsår åbnes automatisk ved første postering i det. Årsafslutning kommer i en senere version.
      </p>
    </div>
  );
}

const ACTION_LABELS: Record<AuditAction, string> = {
  'company.created': 'Virksomhed oprettet',
  'company.updated': 'Virksomhedsdata ændret',
  'account.created': 'Konto oprettet',
  'account.updated': 'Konto ændret',
  'vatRule.created': 'Momsregel oprettet',
  'vatRule.updated': 'Momsregel ændret',
  'period.created': 'Regnskabsår åbnet',
  'transaction.posted': 'Postering bogført',
  'transaction.reversed': 'Postering modposteret',
};

function AuditLog() {
  const { companyId, roles } = useCompany();
  const [max, setMax] = useState(50);
  const allowed = roles.includes('owner') || roles.includes('auditor');
  const log = useAuditLog(allowed ? companyId : null, max);
  if (!allowed) return <Notice>Revisionssporet kan kun ses af ejer og revisor.</Notice>;
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {log.data.map((e) => (
          <li key={e.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
            <span className="w-36 shrink-0 text-xs text-slate-500">{new Date(e.at).toLocaleString('da-DK')}</span>
            <span className="flex-1">
              {ACTION_LABELS[e.action] ?? e.action}
              {typeof e.details['voucherNumber'] === 'number' && (
                <span className="text-slate-500"> · bilag {String(e.details['voucherNumber'])}</span>
              )}
              {e.action.startsWith('account') && e.target && <span className="text-slate-500"> · {e.target}</span>}
              {e.action.startsWith('vatRule') && e.target && <span className="text-slate-500"> · {e.target}</span>}
            </span>
          </li>
        ))}
      </ul>
      {log.data.length >= max && (
        <Button variant="secondary" className="w-full" onClick={() => setMax(max + 50)}>
          Vis flere
        </Button>
      )}
    </div>
  );
}

export function Indstillinger() {
  const [tab, setTab] = useState<Tab>('company');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Indstillinger</h1>
      <div className="-mx-4 overflow-x-auto px-4">
        <div role="tablist" className="inline-flex gap-1 rounded-xl bg-slate-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium',
                tab === t.id ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'company' && <CompanySettings />}
      {tab === 'accounts' && <AccountsSettings />}
      {tab === 'vat' && <VatSettings />}
      {tab === 'years' && <YearsSettings />}
      {tab === 'log' && <AuditLog />}
    </div>
  );
}
