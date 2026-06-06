import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext.js';
import { NotificationBell } from './NotificationBell.js';

type Page = 'dashboard' | 'admin-settings' | 'admin-users';

interface Props {
  page: Page;
  onNavigate: (p: Page) => void;
  children: ReactNode;
}


const navItems: { id: Page; label: string; icon: string; adminOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Assets', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
  { id: 'admin-settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', adminOnly: true },
  { id: 'admin-users', label: 'Users', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', adminOnly: true },
];

export function Layout({ page, onNavigate, children }: Props) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';

  const visibleNav = navItems.filter((n) => !n.adminOnly || isAdmin);

  return (
    <div className="flex h-full min-h-screen bg-surface-0">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col bg-surface-1 border-r border-border">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-content-primary leading-none">Vaultworks</div>
              <div className="text-[10px] text-content-muted mt-0.5">by Bitrograde</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
          {visibleNav.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all text-left ${
                page === item.id
                  ? 'bg-accent text-white'
                  : 'text-content-secondary hover:bg-surface-3 hover:text-content-primary'
              }`}
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                {item.icon.split(' M').map((d, i) => (
                  <path key={i} strokeLinecap="round" strokeLinejoin="round" d={i === 0 ? d : 'M' + d} />
                ))}
              </svg>
              {item.label}
            </button>
          ))}

          {isAdmin && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="px-3 py-1 text-[10px] font-medium text-content-muted uppercase tracking-widest">Admin</div>
            </div>
          )}
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-border">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-accent-light">
                {user?.email?.[0]?.toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-content-primary truncate">{user?.email}</div>
              <div className="text-[10px] text-content-muted capitalize">{user?.role}</div>
            </div>
            <NotificationBell onNavigateDashboard={() => onNavigate('dashboard')} />
            <button
              onClick={logout}
              title="Sign out"
              className="flex-shrink-0 p-1 rounded text-content-muted hover:text-content-primary hover:bg-surface-4 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-auto">
        {children}
      </main>
    </div>
  );
}

export type { Page };
