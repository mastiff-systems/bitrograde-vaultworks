import { useState } from 'react';
import { LoginPage } from './components/LoginPage.js';
import { KeycloakCallback } from './components/KeycloakCallback.js';
import { Layout } from './components/Layout.js';
import { AssetBrowser } from './pages/AssetBrowser.js';
import { AdminPanel } from './pages/admin/AdminPanel.js';
import { ProfilePage } from './pages/Profile.js';
import { Collections } from './pages/Collections.js';
import { useAuth } from './contexts/AuthContext.js';
import { CategoryProvider } from './contexts/CategoryContext.js';
import { UploadProvider } from './contexts/UploadContext.js';
import type { Page } from './components/Layout.js';

function AppShell() {
  const { user } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);

  const handleNavigate = (p: Page) => {
    if (p === 'admin' && user?.role !== 'admin') return;
    setPage(p);
  };

  const handleNavigateToAsset = (assetId: string) => {
    setPendingAssetId(assetId);
    setPage('dashboard');
  };

  return (
    <Layout page={page} onNavigate={handleNavigate}>
      {page === 'dashboard' && <AssetBrowser initialDetailAssetId={pendingAssetId} />}
      {page === 'admin' && user?.role === 'admin' && <AdminPanel onNavigateToAsset={handleNavigateToAsset} />}
      {page === 'profile' && <ProfilePage />}
      {page === 'collections' && <Collections />}
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
      <UploadProvider>
        <AppShell />
      </UploadProvider>
    </CategoryProvider>
  );
}
