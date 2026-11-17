import { useState, type FormEvent } from 'react';
import { authErrorMessage, resetPassword, signIn, signUp } from '../lib/auth';
import { Button, Field, Input, Notice } from '../components/ui';

export function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'in') await signIn(email, password);
      else await signUp(email, password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email) {
      setError('Skriv din e-mail først.');
      return;
    }
    try {
      await resetPassword(email);
      setInfo('Vi har sendt et link til at nulstille adgangskoden.');
      setError(null);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="mb-8 text-center">
          <img src="/icon.svg" alt="" className="mx-auto mb-3 h-12 w-12" />
          <h1 className="text-2xl font-semibold">Bogført</h1>
          <p className="mt-1 text-sm text-slate-500">Enkel bogføring, efter reglerne.</p>
        </div>
        <Field label="E-mail">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Adgangskode">
          <Input
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        {info && <Notice tone="success">{info}</Notice>}
        <Button type="submit" disabled={busy} className="w-full">
          {mode === 'in' ? 'Log ind' : 'Opret konto'}
        </Button>
        <div className="flex justify-between text-sm">
          <button type="button" className="text-slate-600 hover:underline" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
            {mode === 'in' ? 'Opret ny konto' : 'Har du en konto? Log ind'}
          </button>
          {mode === 'in' && (
            <button type="button" className="text-slate-500 hover:underline" onClick={forgot}>
              Glemt adgangskode
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
