import { useState } from 'react';
import { LoginPage } from './components/LoginPage.js';
import { KeycloakCallback } from './components/KeycloakCallback.js';
import { Layout } from './components/Layout.js';
import { AssetBrowser } from './pages/AssetBrowser.js';
import { AdminSettings } from './pages/admin/Settings.js';
import { AdminUsers } from './pages/admin/Users.js';
import { useAuth } from './contexts/AuthContext.js';
import type { Page } from './components/Layout.js';

function AppShell() {
  const { user } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');

  const handleNavigate = (p: Page) => {
    // Guard admin-only pages
    if ((p === 'admin-settings' || p === 'admin-users') && user?.role !== 'admin') return;
    setPage(p);
  };

  return (
    <Layout page={page} onNavigate={handleNavigate}>
      {page === 'dashboard' && <AssetBrowser />}
      {page === 'admin-settings' && user?.role === 'admin' && <AdminSettings />}
      {page === 'admin-users' && user?.role === 'admin' && <AdminUsers />}
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
