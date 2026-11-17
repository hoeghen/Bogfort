import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useCompany } from '../lib/company';
import { useOnline } from '../lib/hooks';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Kassekladde', end: true },
  { to: '/posteringer', label: 'Posteringer', end: false },
];

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'rounded-xl px-3 py-2 text-sm font-medium transition',
    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  );

/**
 * Daily work up front, configuration out of sight: two destinations in the
 * nav, and a muted gear for everything else (spec §1, "Skjult opsætningsmenu").
 */
export function Layout({ children }: { children: ReactNode }) {
  const { company } = useCompany();
  const online = useOnline();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <span className="truncate font-semibold">{company.name}</span>
          {!online && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Offline</span>
          )}
          <nav className="ml-auto hidden items-center gap-1 sm:flex" aria-label="Hovedmenu">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <NavLink
            to="/indstillinger"
            aria-label="Indstillinger"
            title="Indstillinger"
            className={({ isActive }) =>
              cx('ml-auto rounded-lg p-2 sm:ml-2', isActive ? 'text-slate-900' : 'text-slate-400 hover:text-slate-700')
            }
          >
            <GearIcon />
          </NavLink>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-28 sm:pb-10">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
        aria-label="Hovedmenu"
      >
        <div className="grid grid-cols-2 gap-1 p-2">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={(s) => cx(navClass(s), 'text-center')}>
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
