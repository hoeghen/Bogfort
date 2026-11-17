import { useState, type FormEvent } from 'react';
import { createCompany, errorMessage } from '../lib/data';
import { signOut } from '../lib/auth';
import { Button, Field, Input, Notice, Select } from '../components/ui';

const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

/** First run: one short form, then the standard chart is ready and the user lands in the kassekladde. */
export function Onboarding() {
  const [name, setName] = useState('');
  const [cvr, setCvr] = useState('');
  const [startMonth, setStartMonth] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createCompany({ name, cvr: cvr.trim() || null, address: null, fiscalYearStartMonth: startMonth });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Kom i gang</h1>
          <p className="mt-1 text-sm text-slate-500">
            Vi opretter en standardkontoplan med moms, så du kan bogføre med det samme.
          </p>
        </div>
        <Field label="Virksomhedens eller foreningens navn">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="CVR-nummer" hint="Kan udelades for foreninger uden CVR.">
          <Input inputMode="numeric" value={cvr} onChange={(e) => setCvr(e.target.value)} placeholder="12345678" />
        </Field>
        <Field label="Regnskabsåret starter i">
          <Select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Opretter…' : 'Opret'}
        </Button>
        <button type="button" onClick={() => void signOut()} className="w-full text-sm text-slate-500 hover:underline">
          Log ud
        </button>
      </form>
    </div>
  );
}
