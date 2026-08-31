import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { useTheme } from '../contexts/ThemeContext.js';
import { useCategoryContext } from '../contexts/CategoryContext.js';
import { useUpload } from '../contexts/UploadContext.js';
import { NotificationBell } from './NotificationBell.js';
import { ThemeToggle } from './ThemeToggle.js';

interface Props {
  children: ReactNode;
}

function ProfileDropdown() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
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
          <div className="absolute right-0 top-full mt-1.5 z-40 w-52 card py-1 shadow-xl">
            <div className="px-3 py-2 border-b border-border/50 mb-1">
              <p className="text-xs font-medium text-content-primary truncate">{user?.email}</p>
              <p className="text-[10px] text-content-muted capitalize">{user?.role}</p>
            </div>

            {/* My Profile — available to all users */}
            <button
              onClick={() => { setOpen(false); navigate('/profile'); }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                location.pathname === '/profile'
                  ? 'text-accent bg-accent/5'
                  : 'text-content-secondary hover:text-content-primary hover:bg-surface-3'
              }`}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              My Profile
            </button>

            {isAdmin && (
              <>
                <button
                  onClick={() => { setOpen(false); navigate('/admin/settings'); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    location.pathname === '/admin/settings'
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
                  onClick={() => { setOpen(false); navigate('/admin/taxonomy'); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    location.pathname === '/admin/taxonomy'
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
                  onClick={() => { setOpen(false); navigate('/admin/users'); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    location.pathname === '/admin/users'
                      ? 'text-accent bg-accent/5'
                      : 'text-content-secondary hover:text-content-primary hover:bg-surface-3'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  Users
                </button>
                <button
                  onClick={() => { setOpen(false); navigate('/admin/audit'); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    location.pathname === '/admin/audit'
                      ? 'text-accent bg-accent/5'
                      : 'text-content-secondary hover:text-content-primary hover:bg-surface-3'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                  </svg>
                  Audit Log
                </button>
              </>
            )}

            {/* Collections — available to all users */}
            <button
              onClick={() => { setOpen(false); navigate('/collections'); }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                location.pathname === '/collections'
                  ? 'text-accent bg-accent/5'
                  : 'text-content-secondary hover:text-content-primary hover:bg-surface-3'
              }`}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25A2.25 2.25 0 004.5 16.5h15a2.25 2.25 0 002.25-2.25V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              Collections
            </button>

            <div className="border-t border-border/50 mt-1 pt-1">
              <button
                onClick={toggleTheme}
                className="w-full text-left px-3 py-2 text-sm text-content-secondary hover:text-content-primary hover:bg-surface-3 transition-colors flex items-center gap-2"
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  {theme === 'dark' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  )}
                </svg>
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>

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

export function Layout({ children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { categories, selectedCategoryId, selectedSubcategoryId, searchQuery, setSelectedCategoryId, setSelectedSubcategoryId, setSearchQuery } = useCategoryContext();
  const upload = useUpload();

  const isDashboard = location.pathname === '/';
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const subcategories = selectedCategory?.subcategories ?? [];

  return (
    <div className="flex flex-col h-full min-h-screen bg-surface-0">

      {/* ── Top Navigation ── */}
      <header className="flex-shrink-0 bg-surface-1 border-b border-border">

        {/* Main bar: Logo | centered search | Controls */}
        <div className="relative flex items-center px-4 h-14">

          {/* Logo — left */}
          <button
            onClick={() => { navigate('/'); setSelectedCategoryId(null); }}
            className="flex items-center gap-2 flex-shrink-0 mr-1 hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
          >
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-content-primary hidden sm:block leading-none">Vaultworks</span>
          </button>

          {/* Centered search + upload — dashboard only, absolute in header */}
          {isDashboard && (
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 w-56 sm:w-[400px] lg:w-[580px] pointer-events-none">
              {/* Search */}
              <div className="relative flex-1 pointer-events-auto">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-muted pointer-events-none"
                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <input
                  className="input pl-8 py-1.5 text-sm h-8 w-full"
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

              {/* Upload button */}
              <button
                onClick={upload.openWizard}
                disabled={upload.uploading}
                className="btn-primary flex-shrink-0 pointer-events-auto h-8 text-sm"
              >
                {upload.uploading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {upload.progress}%
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    Upload
                  </>
                )}
              </button>
            </div>
          )}

          {/* Spacer — pushes controls to the right */}
          <div className="flex-1" />

          {/* Right controls */}
          <div className="flex items-center gap-1 flex-shrink-0 ml-1">
            <NotificationBell onNavigateDashboard={() => navigate('/')} />
            <ThemeToggle />
            <ProfileDropdown />
          </div>
        </div>

        {/* Category tabs row — dashboard only */}
        {isDashboard && (
          <nav
            className="flex items-center gap-0.5 px-4 pb-2 overflow-x-auto bg-surface-1"
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
      </header>

      {/* ── Subcategory chip bar ── */}
      {isDashboard && subcategories.length > 0 && (
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
                onClick={() => setSelectedSubcategoryId(selectedSubcategoryId === sub.id ? null : sub.id)}
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
