import { useState } from 'react';
import { LoginPage } from './components/LoginPage.js';
import { KeycloakCallback } from './components/KeycloakCallback.js';
import { Layout } from './components/Layout.js';
import { AssetBrowser } from './pages/AssetBrowser.js';
import { AdminPanel } from './pages/admin/AdminPanel.js';
import { ProfilePage } from './pages/Profile.js';
import { useAuth } from './contexts/AuthContext.js';
import { CategoryProvider } from './contexts/CategoryContext.js';
import type { Page } from './components/Layout.js';

function AppShell() {
  const { user } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');

  const handleNavigate = (p: Page) => {
    if (p === 'admin' && user?.role !== 'admin') return;
    setPage(p);
  };

  return (
    <Layout page={page} onNavigate={handleNavigate}>
      {page === 'dashboard' && <AssetBrowser />}
      {page === 'admin' && user?.role === 'admin' && <AdminPanel />}
      {page === 'profile' && <ProfilePage />}
    </Layout>
  );
}

export function App() {
  const { token } = useAuth();

  if (window.location.pathname === '/auth/callback') {
    return <KeycloakCallback />;
  }

  if (!token) return <LoginPage />;
  return (
    <CategoryProvider>
      <AppShell />
    </CategoryProvider>
  );
}
