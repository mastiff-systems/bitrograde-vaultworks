import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { useTheme } from '../contexts/ThemeContext.js';
import { useCategoryContext } from '../contexts/CategoryContext.js';
import { useUpload } from '../contexts/UploadContext.js';
import { NotificationBell } from './NotificationBell.js';
import { AdminMenu } from './AdminMenu.js';

interface Props {
  children: ReactNode;
}

/** Icon-only header link to /collections — available to all roles (MAS-736). */
function CollectionsButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const active = location.pathname === '/collections';

  return (
    <button
      onClick={() => navigate('/collections')}
      aria-label="Collections"
      title="Collections"
      className={`relative flex-shrink-0 p-1.5 rounded transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 focus:outline-none before:content-[''] before:absolute before:-inset-2 ${
        active
          ? 'text-accent bg-accent/5'
          : 'text-content-muted hover:text-content-primary hover:bg-surface-4'
      }`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25A2.25 2.25 0 004.5 16.5h15a2.25 2.25 0 002.25-2.25V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    </button>
  );
}

function ProfileDropdown() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
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
        className="relative w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center hover:bg-accent/30 transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 focus:outline-none before:content-[''] before:absolute before:-inset-1.5"
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
                Log out
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
            <div className="flex items-center gap-2 flex-1 min-w-0 mx-2 sm:absolute sm:left-1/2 sm:-translate-x-1/2 sm:flex-none sm:min-w-0 sm:mx-0 sm:w-[400px] lg:w-[580px] pointer-events-none">
              {/* Search */}
              <div className="relative flex-1 min-w-0 pointer-events-auto">
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

          {/* Spacer — pushes controls to the right; on mobile the dashboard
              search group is in-flow and takes this space itself */}
          <div className={isDashboard ? 'hidden sm:block sm:flex-1' : 'flex-1'} />

          {/* Right controls */}
          <div className="flex items-center gap-1 flex-shrink-0 ml-1">
            <NotificationBell onNavigateDashboard={() => navigate('/')} />
            <CollectionsButton />
            <AdminMenu />
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
