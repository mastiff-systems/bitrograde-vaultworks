import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext.js';
import { useCategoryContext } from '../contexts/CategoryContext.js';
import { NotificationBell } from './NotificationBell.js';
import { ThemeToggle } from './ThemeToggle.js';

type Page = 'dashboard' | 'admin-settings' | 'admin-users' | 'admin-taxonomy';

interface Props {
  page: Page;
  onNavigate: (p: Page) => void;
  children: ReactNode;
}

function ProfileDropdown({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile menu"
        aria-haspopup="true"
        aria-expanded={open}
        className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center hover:bg-accent/30 transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 focus:outline-none"
      >
        <span className="text-xs font-semibold text-accent-light">
          {user?.email?.[0]?.toUpperCase()}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-40 w-48 card py-1 shadow-xl">
            <div className="px-3 py-2 border-b border-border/50 mb-1">
              <p className="text-xs font-medium text-content-primary truncate">{user?.email}</p>
              <p className="text-[10px] text-content-muted capitalize">{user?.role}</p>
            </div>

            {isAdmin && (
              <>
                <button
                  onClick={() => { setOpen(false); onNavigate('admin-settings'); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    page === 'admin-settings'
                      ? 'text-accent bg-accent/5'
                      : 'text-content-secondary hover:text-content-primary hover:bg-surface-3'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>
                <button
                  onClick={() => { setOpen(false); onNavigate('admin-taxonomy'); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    page === 'admin-taxonomy'
                      ? 'text-accent bg-accent/5'
                      : 'text-content-secondary hover:text-content-primary hover:bg-surface-3'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  Taxonomy
                </button>
                <button
                  onClick={() => { setOpen(false); onNavigate('admin-users'); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    page === 'admin-users'
                      ? 'text-accent bg-accent/5'
                      : 'text-content-secondary hover:text-content-primary hover:bg-surface-3'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  Users
                </button>
              </>
            )}

            <div className="border-t border-border/50 mt-1">
              <button
                onClick={() => { setOpen(false); logout(); }}
                className="w-full text-left px-3 py-2 text-sm text-content-secondary hover:text-danger hover:bg-surface-3 transition-colors flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Layout({ page, onNavigate, children }: Props) {
  const { categories, selectedCategoryId, selectedSubcategoryId, searchQuery, setSelectedCategoryId, setSelectedSubcategoryId, setSearchQuery } = useCategoryContext();

  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const subcategories = selectedCategory?.subcategories ?? [];

  return (
    <div className="flex flex-col h-full min-h-screen bg-surface-0">

      {/* ── Top Navigation ── */}
      <header className="flex-shrink-0 bg-surface-1 border-b border-border">
        <div className="flex items-center gap-2 px-4 h-14">

          {/* Logo */}
          <button
            onClick={() => { onNavigate('dashboard'); setSelectedCategoryId(null); }}
            className="flex items-center gap-2 flex-shrink-0 mr-1 hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
          >
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-content-primary hidden sm:block leading-none">Vaultworks</span>
          </button>

          {/* Category tabs — dashboard only */}
          {page === 'dashboard' && (
            <nav
              className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0 py-1"
              aria-label="Asset categories"
              style={{ scrollbarWidth: 'none' }}
            >
              <button
                onClick={() => setSelectedCategoryId(null)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  selectedCategoryId === null
                    ? 'bg-accent text-white'
                    : 'text-content-secondary hover:bg-surface-3 hover:text-content-primary'
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                    selectedCategoryId === cat.id
                      ? 'bg-accent text-white'
                      : 'text-content-secondary hover:bg-surface-3 hover:text-content-primary'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </nav>
          )}

          {/* Spacer on non-dashboard pages */}
          {page !== 'dashboard' && <div className="flex-1" />}

          {/* Global search — dashboard only */}
          {page === 'dashboard' && (
            <div className="relative flex-shrink-0 w-44 sm:w-56 lg:w-72">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-muted pointer-events-none"
                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                className="input pl-8 py-1.5 text-sm h-8"
                placeholder="Search assets…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search assets"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-primary transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Right controls */}
          <div className="flex items-center gap-1 flex-shrink-0 ml-1">
            <NotificationBell onNavigateDashboard={() => onNavigate('dashboard')} />
            <ThemeToggle />
            <ProfileDropdown page={page} onNavigate={onNavigate} />
          </div>
        </div>
      </header>

      {/* ── Subcategory chip bar ── */}
      {page === 'dashboard' && subcategories.length > 0 && (
        <div
          className="flex-shrink-0 bg-surface-0 border-b border-border/60"
          role="navigation"
          aria-label="Subcategory filters"
        >
          <div
            className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto"
            style={{ scrollbarWidth: 'none' }}
          >
            <button
              onClick={() => setSelectedSubcategoryId(null)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                selectedSubcategoryId === null
                  ? 'bg-accent text-white border-accent'
                  : 'text-content-secondary border-border hover:border-border-light hover:text-content-primary bg-surface-1'
              }`}
            >
              All
            </button>
            {subcategories.map((sub) => (
              <button
                key={sub.id}
                onClick={() => setSelectedSubcategoryId(sub.id)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all border whitespace-nowrap ${
                  selectedSubcategoryId === sub.id
                    ? 'bg-accent text-white border-accent'
                    : 'text-content-secondary border-border hover:border-border-light hover:text-content-primary bg-surface-1'
                }`}
              >
                {sub.name}
                {sub.asset_count > 0 && (
                  <span className={`ml-1.5 tabular-nums ${selectedSubcategoryId === sub.id ? 'text-white/70' : 'text-content-muted'}`}>
                    {sub.asset_count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 min-h-0 flex flex-col overflow-auto">
        {children}
      </main>
    </div>
  );
}

export type { Page };
