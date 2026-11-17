import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  buildPostingLines,
  draftAttachmentPath,
  formatAmount,
  formatDate,
  formatRate,
  parseAmount,
  PostingError,
  postsVat,
  suggestContra,
  suggestKind,
  todayIso,
  vatFromGross,
  type AttachmentRef,
  type Draft,
  type DraftKind,
} from '../shared';
import { AccountSelect } from '../components/AccountSelect';
import { Button, Card, Field, Input, Notice, Segmented, Select, cx } from '../components/ui';
import { useCompany } from '../lib/company';
import {
  deleteDraft,
  errorMessage,
  newDraftId,
  postDrafts,
  saveDraft,
  useDrafts,
  type PostDraftsResult,
  type WithId,
} from '../lib/data';
import { useOnline } from '../lib/hooks';
import { dropQueued, enqueueUpload, removeUploaded } from '../lib/uploads';

interface FormState {
  editingId: string | null;
  kind: DraftKind;
  account: string;
  amount: string;
  date: string;
  text: string;
  /** null = follow the suggestion. */
  contra: string | null;
  /** undefined = follow the account's default. */
  vatCode: string | null | undefined;
  file: File | null;
  existing: AttachmentRef | null;
  existingPending: boolean;
}

const emptyForm = (date = todayIso()): FormState => ({
  editingId: null,
  kind: 'expense',
  account: '',
  amount: '',
  date,
  text: '',
  contra: null,
  vatCode: undefined,
  file: null,
  existing: null,
  existingPending: false,
});

function formFromDraft(d: WithId<Draft>): FormState {
  return {
    editingId: d.id,
    kind: d.kind,
    account: d.account,
    amount: formatAmount(d.amount),
    date: d.date,
    text: d.text,
    contra: d.contraAccount,
    vatCode: d.vatCode,
    file: null,
    existing: d.attachment,
    existingPending: d.attachmentPending,
  };
}

/**
 * Remounted (via `key`) whenever a different line is opened for editing, so
 * its state always starts from the line it shows.
 */
function DraftForm({
  editing,
  initialDate,
  onDone,
}: {
  editing: WithId<Draft> | null;
  initialDate: string;
  onDone: (lastDate: string) => void;
}) {
  const { companyId, company, accounts, vatRules, account, vatRule, uid } = useCompany();
  const [f, setF] = useState<FormState>(() => (editing ? formFromDraft(editing) : emptyForm(initialDate)));
  const [details, setDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const acc = account(f.account);
  const contraNumber = f.contra ?? suggestContra(acc, company.defaultContraAccount);
  const vatCode = f.vatCode !== undefined ? f.vatCode : (acc?.vatCode ?? null);
  const rule = vatRule(vatCode);
  const vatName = rule?.name ?? 'Ingen moms';
  const amount = parseAmount(f.amount);
  const vat = amount && postsVat(rule) ? vatFromGross(amount, rule.rate) : 0;
  const contraAcc = account(contraNumber);

  // Run the same posting logic the server will, so mistakes show up here, not at "Bogfør".
  const problem = useMemo(() => {
    if (!acc || !contraAcc || !amount) return null;
    try {
      buildPostingLines({ kind: f.kind, amount, account: acc, contra: contraAcc, vatRule: rule ?? null, vatAccount: company.vatAccount });
      return null;
    } catch (e) {
      return e instanceof PostingError ? e.message : null;
    }
  }, [acc, contraAcc, amount, f.kind, rule, company.vatAccount]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  function pickAccount(n: string) {
    const a = account(n);
    setF((s) => ({ ...s, account: n, kind: suggestKind(a), contra: null, vatCode: undefined }));
  }

  function pickFile(file: File | null) {
    setError(null);
    if (!file) return set('file', null);
    if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
      setError('Bilag skal være PDF, PNG eller JPG.');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError('Bilaget må højst fylde 20 MB.');
      return;
    }
    set('file', file);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!acc) return setError('Vælg en konto.');
    if (!amount) return setError('Skriv et beløb, fx 1.250,00.');
    if (!f.text.trim()) return setError('Skriv en kort tekst.');
    if (!contraAcc) return setError('Vælg en modkonto.');
    if (problem) return setError(problem);

    const id = f.editingId ?? newDraftId(companyId);
    let attachment = f.existing;
    let attachmentPending = f.existingPending;
    if (f.file) {
      const path = draftAttachmentPath(companyId, id, f.file.name);
      if (f.existing && f.existing.path !== path) {
        void dropQueued(f.existing.path);
        void removeUploaded(f.existing.path);
      }
      attachment = { path, name: f.file.name, contentType: f.file.type, size: f.file.size };
      attachmentPending = true;
    }

    const now = Date.now();
    const draft: Draft = {
      date: f.date,
      text: f.text.trim(),
      kind: f.kind,
      amount,
      account: acc.number,
      contraAccount: contraAcc.number,
      vatCode: vatCode,
      attachment,
      attachmentPending,
      // Keep the original creation stamp when editing (the rules insist on it).
      createdBy: editing?.createdBy ?? uid,
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
    };

    // Not awaited: offline, the write is queued locally and the form is free at once.
    saveDraft(companyId, id, draft).catch((err) => setError(errorMessage(err)));
    if (f.file && attachment) {
      void enqueueUpload({ path: attachment.path, companyId, draftId: id, blob: f.file, contentType: f.file.type });
    }
    if (fileInput.current) fileInput.current.value = '';
    if (editing) {
      onDone(f.date);
    } else {
      setF(emptyForm(f.date));
      setDetails(false);
      onDone(f.date);
    }
  }

  const fileLabel = f.file?.name ?? f.existing?.name ?? null;

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{f.editingId ? 'Ret linje' : 'Ny postering'}</h2>
          <Segmented<DraftKind>
            label="Type"
            value={f.kind}
            onChange={(v) => setF((s) => ({ ...s, kind: v, vatCode: undefined }))}
            options={[
              { value: 'expense', label: 'Udgift' },
              { value: 'income', label: 'Indtægt' },
            ]}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Konto">
            <AccountSelect accounts={accounts} value={f.account} onChange={pickAccount} />
          </Field>
          <Field label="Beløb inkl. moms">
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={f.amount}
              onChange={(e) => set('amount', e.target.value)}
              className="num text-right"
            />
          </Field>
          <Field label="Tekst" className="sm:col-span-2">
            <Input maxLength={200} placeholder="Fx Printerpapir, Føtex" value={f.text} onChange={(e) => set('text', e.target.value)} />
          </Field>
          <Field label="Dato">
            <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} required />
          </Field>
          <Field label="Bilag">
            <label
              className={cx(
                'flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm',
                fileLabel ? 'border-emerald-400 bg-emerald-50 text-emerald-900' : 'border-slate-300 text-slate-500 hover:bg-slate-50',
              )}
            >
              <input
                ref={fileInput}
                type="file"
                accept={ALLOWED_ATTACHMENT_TYPES.join(',')}
                className="sr-only"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              <span className="truncate">{fileLabel ?? 'Tag foto eller vælg fil'}</span>
            </label>
          </Field>
        </div>

        {acc && (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {f.kind === 'expense' ? 'Betalt fra' : 'Indsat på'}{' '}
                <strong className="font-medium text-slate-800">{contraAcc ? `${contraAcc.number} ${contraAcc.name}` : '–'}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {rule && postsVat(rule) ? (
                  <>
                    Moms {formatRate(rule.rate)}
                    {amount ? <span className="num"> = {formatAmount(vat)} kr.</span> : null}
                  </>
                ) : (
                  vatName
                )}
              </span>
              <button type="button" className="ml-auto text-slate-500 underline-offset-2 hover:underline" onClick={() => setDetails(!details)}>
                {details ? 'Skjul' : 'Ændr'}
              </button>
            </div>
            {details && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Modkonto">
                  <AccountSelect accounts={accounts} value={contraNumber} onChange={(v) => set('contra', v)} exclude={f.account} />
                </Field>
                <Field label="Moms">
                  <Select value={vatCode ?? ''} onChange={(e) => set('vatCode', e.target.value || null)}>
                    <option value="">Ingen moms</option>
                    {vatRules
                      .filter((v) => v.active && v.kind === 'standard')
                      .map((v) => (
                        <option key={v.code} value={v.code}>
                          {v.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>
            )}
          </div>
        )}

        {(error || problem) && <Notice tone="error">{error ?? problem}</Notice>}

        <div className="flex gap-2">
          <Button type="submit" className="flex-1 sm:flex-none">
            {f.editingId ? 'Gem ændringer' : 'Tilføj til kladde'}
          </Button>
          {f.editingId && (
            <Button type="button" variant="ghost" onClick={() => onDone(f.date)}>
              Annuller
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function attachmentStatus(d: Draft): { label: string; tone: string } {
  if (!d.attachment) return { label: 'Mangler bilag', tone: 'text-amber-700' };
  if (d.attachmentPending) return { label: 'Uploader bilag…', tone: 'text-slate-500' };
  return { label: 'Bilag', tone: 'text-emerald-700' };
}

export function Kassekladde() {
  const { companyId, account, can } = useCompany();
  const drafts = useDrafts(companyId);
  const online = useOnline();
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<PostDraftsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState(todayIso);
  const editing = drafts.data.find((d) => d.id === editingId) ?? null;

  function edit(id: string) {
    setEditingId(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const ready = drafts.data.filter((d) => d.attachment && !d.attachmentPending);
  const failedById = new Map(result?.failed.map((f) => [f.draftId, f.message]));

  async function post() {
    if (ready.length === 0) return;
    const ok = window.confirm(
      `Bogfør ${ready.length} ${ready.length === 1 ? 'linje' : 'linjer'}?\n\nBogførte posteringer får et fortløbende bilagsnummer og kan ikke ændres bagefter — kun modposteres.`,
    );
    if (!ok) return;
    setPosting(true);
    setError(null);
    setResult(null);
    try {
      setResult(await postDrafts({ companyId, draftIds: ready.map((d) => d.id) }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPosting(false);
    }
  }

  async function remove(d: WithId<Draft>) {
    if (!window.confirm(`Slet "${d.text}" fra kladden?`)) return;
    if (editingId === d.id) setEditingId(null);
    deleteDraft(companyId, d.id).catch((err) => setError(errorMessage(err)));
    if (d.attachment) {
      void dropQueued(d.attachment.path);
      void removeUploaded(d.attachment.path);
    }
  }

  const posted = result?.posted ?? [];

  return (
    <div className="space-y-4">
      {can.book && (
        <DraftForm
          key={editing?.id ?? 'new'}
          editing={editing}
          initialDate={lastDate}
          onDone={(date) => {
            setLastDate(date);
            setEditingId(null);
            setResult(null);
          }}
        />
      )}

      {posted.length > 0 && (
        <Notice tone="success">
          {posted.length === 1
            ? `Bogført som bilag ${posted[0]!.voucherNumber}.`
            : `${posted.length} linjer bogført (bilag ${Math.min(...posted.map((p) => p.voucherNumber))}–${Math.max(...posted.map((p) => p.voucherNumber))}).`}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <section aria-labelledby="kladde-h">
        <div className="mb-2 flex items-end justify-between">
          <h2 id="kladde-h" className="text-sm font-semibold text-slate-500">
            Kladde {drafts.data.length > 0 && <span className="font-normal">({drafts.data.length})</span>}
          </h2>
        </div>

        {drafts.loading ? null : drafts.data.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
            Kladden er tom. Tilføj en udgift eller indtægt ovenfor.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {drafts.data.map((d) => {
              const status = attachmentStatus(d);
              const failure = failedById.get(d.id);
              return (
                <li key={d.id} className="flex items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => can.book && edit(d.id)}
                    disabled={!can.book}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">{d.text}</span>
                      <span className={cx('num shrink-0 font-medium', d.kind === 'income' && 'text-emerald-700')}>
                        {d.kind === 'income' ? '+' : '−'}
                        {formatAmount(d.amount)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
                      <span>{formatDate(d.date)}</span>
                      <span>
                        {d.account} {account(d.account)?.name ?? ''}
                      </span>
                      <span className={status.tone}>{status.label}</span>
                    </div>
                    {failure && <p className="mt-1 text-xs text-red-700">{failure}</p>}
                  </button>
                  {can.book && (
                    <button
                      type="button"
                      onClick={() => void remove(d)}
                      aria-label={`Slet ${d.text}`}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {can.book && drafts.data.length > 0 && (
        <div className="sticky bottom-20 sm:bottom-4">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
            <p className="flex-1 text-xs text-slate-500">
              {!online
                ? 'Du er offline. Kladden gemmes og kan bogføres, når du er online igen.'
                : ready.length < drafts.data.length
                  ? `${drafts.data.length - ready.length} ${drafts.data.length - ready.length === 1 ? 'linje mangler' : 'linjer mangler'} bilag.`
                  : 'Alle linjer er klar.'}
            </p>
            <Button onClick={() => void post()} disabled={!online || posting || ready.length === 0}>
              {posting ? 'Bogfører…' : `Bogfør ${ready.length || ''}`.trim()}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
