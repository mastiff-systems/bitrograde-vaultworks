import { useState } from 'react';
import { LoginPage } from './components/LoginPage.js';
import { KeycloakCallback } from './components/KeycloakCallback.js';
import { Layout } from './components/Layout.js';
import { AssetBrowser } from './pages/AssetBrowser.js';
import { AdminSettings } from './pages/admin/Settings.js';
import { AdminUsers } from './pages/admin/Users.js';
import { TaxonomyManager } from './pages/admin/TaxonomyManager.js';
import { useAuth } from './contexts/AuthContext.js';
import type { Page } from './components/Layout.js';

const ADMIN_PAGES: Page[] = ['admin-settings', 'admin-users', 'admin-taxonomy'];

function AppShell() {
  const { user } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');

  const handleNavigate = (p: Page) => {
    if (ADMIN_PAGES.includes(p) && user?.role !== 'admin') return;
    setPage(p);
  };

  return (
    <Layout page={page} onNavigate={handleNavigate}>
      {page === 'dashboard' && <AssetBrowser />}
      {page === 'admin-settings' && user?.role === 'admin' && <AdminSettings />}
      {page === 'admin-users' && user?.role === 'admin' && <AdminUsers />}
      {page === 'admin-taxonomy' && user?.role === 'admin' && <TaxonomyManager />}
    </Layout>
  );
}

export function App() {
  const { token } = useAuth();

  if (window.location.pathname === '/auth/callback') {
    return <KeycloakCallback />;
  }

  if (!token) return <LoginPage />;
  return <AppShell />;
}
