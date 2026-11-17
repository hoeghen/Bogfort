import { useState } from 'react';
import { formatAmount, formatDate, type Transaction } from '../shared';
import { Button, Notice, cx } from '../components/ui';
import { useCompany } from '../lib/company';
import {
  attachmentUrl,
  errorMessage,
  reverseTransaction,
  useReversals,
  useTransactions,
  type WithId,
} from '../lib/data';
import { useOnline } from '../lib/hooks';

const PAGE = 50;

function TransactionDetail({ t, reversedBy }: { t: WithId<Transaction>; reversedBy: number | null }) {
  const { companyId, account, can } = useCompany();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function openBilag() {
    if (!t.attachment) return;
    // Open the tab synchronously so pop-up blockers allow it, then point it at the file.
    const win = window.open('', '_blank');
    try {
      const url = await attachmentUrl(t.attachment.path);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      win?.close();
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  async function reverse() {
    const reason = window.prompt(
      `Modposter bilag ${t.voucherNumber}?\n\nDer oprettes en ny postering dateret i dag, som ophæver denne. Skriv en kort begrundelse:`,
    );
    if (!reason?.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await reverseTransaction({ companyId, postId: t.postId, reason: reason.trim() });
      setMessage({ tone: 'success', text: `Modposteret som bilag ${r.voucherNumber}.` });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 font-medium">Konto</th>
            <th className="py-1 text-right font-medium">Debet</th>
            <th className="py-1 text-right font-medium">Kredit</th>
          </tr>
        </thead>
        <tbody>
          {t.lines.map((l, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="py-1.5">
                {l.account} <span className="text-slate-500">{account(l.account)?.name}</span>
                {l.vatDirection && <span className="ml-1 text-xs text-slate-400">(moms)</span>}
              </td>
              <td className="num py-1.5 text-right">{l.debit ? formatAmount(l.debit) : ''}</td>
              <td className="num py-1.5 text-right">{l.credit ? formatAmount(l.credit) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="grid gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
        <div>
          <dt className="inline">Bogført: </dt>
          <dd className="inline">{new Date(t.postedAt).toLocaleString('da-DK')}</dd>
        </div>
        {t.attachment && (
          <div className="truncate">
            <dt className="inline">SHA-256: </dt>
            <dd className="inline font-mono" title={t.attachment.sha256}>
              {t.attachment.sha256.slice(0, 16)}…
            </dd>
          </div>
        )}
      </dl>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="flex flex-wrap gap-2">
        {t.attachment && (
          <Button variant="secondary" onClick={() => void openBilag()}>
            Vis bilag
          </Button>
        )}
        {can.book && t.kind !== 'reversal' && reversedBy === null && (
          <Button variant="ghost" onClick={() => void reverse()} disabled={busy || !online}>
            Modposter
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The posted journal: read-only by design. The only action on a voucher is a
 * modpostering, which adds a new voucher rather than touching this one.
 */
export function Posteringer() {
  const { companyId, account } = useCompany();
  const [max, setMax] = useState(PAGE);
  const txs = useTransactions(companyId, max);
  const reversals = useReversals(companyId);
  const [open, setOpen] = useState<string | null>(null);
  const reversedBy = new Map(reversals.data.map((r) => [r.id, r.reversedByVoucher]));

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Posteringer</h1>
      {txs.error && <Notice tone="error">Kunne ikke hente posteringer.</Notice>}
      {!txs.loading && txs.data.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          Ingen bogførte posteringer endnu.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {txs.data.map((t) => {
            const main = t.lines[0];
            const rev = reversedBy.get(t.postId) ?? null;
            const isOpen = open === t.id;
            return (
              <li key={t.id} className="border-b border-slate-100 last:border-b-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : t.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="num w-10 shrink-0 pt-0.5 text-xs font-medium text-slate-400">#{t.voucherNumber}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={cx('truncate font-medium', rev !== null && 'text-slate-400 line-through')}>{t.text}</span>
                      <span className={cx('num shrink-0 font-medium', t.kind === 'income' && 'text-emerald-700')}>
                        {formatAmount(t.amount)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
                      <span>{formatDate(t.date)}</span>
                      {main && t.kind !== 'reversal' && (
                        <span>
                          {main.account} {account(main.account)?.name}
                        </span>
                      )}
                      {rev !== null && <span className="text-amber-700">Modposteret af #{rev}</span>}
                      {t.kind === 'reversal' && <span className="text-amber-700">Modpostering</span>}
                    </span>
                  </span>
                </button>
                {isOpen && <TransactionDetail t={t} reversedBy={rev} />}
              </li>
            );
          })}
        </ul>
      )}
      {txs.data.length >= max && (
        <Button variant="secondary" className="w-full" onClick={() => setMax(max + PAGE)}>
          Vis flere
        </Button>
      )}
    </div>
  );
}
