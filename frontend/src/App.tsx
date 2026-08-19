import { useState } from 'react';
import { LoginPage } from './components/LoginPage.js';
import { KeycloakCallback } from './components/KeycloakCallback.js';
import { Layout } from './components/Layout.js';
import { AssetBrowser } from './pages/AssetBrowser.js';
import { AdminPanel } from './pages/admin/AdminPanel.js';
import { AdminAuditLog } from './pages/AdminAuditLog.js';
import { ProfilePage } from './pages/Profile.js';
import { Collections } from './pages/Collections.js';
import { ResetPassword } from './pages/ResetPassword.js';
import { useAuth } from './contexts/AuthContext.js';
import { CategoryProvider } from './contexts/CategoryContext.js';
import { UploadProvider } from './contexts/UploadContext.js';
import type { Page } from './components/Layout.js';

function AppShell() {
  const { user } = useAuth();
  const [page, setPage] = useState<Page>('dashboard');
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);

  const handleNavigate = (p: Page) => {
    if ((p === 'admin' || p === 'audit') && user?.role !== 'admin') return;
    setPage(p);
  };

  const handleNavigateToAsset = (assetId: string) => {
    setPendingAssetId(assetId);
    setPage('dashboard');
  };

  return (
    <Layout page={page} onNavigate={handleNavigate}>
      {page === 'dashboard' && <AssetBrowser initialDetailAssetId={pendingAssetId} />}
      {page === 'admin' && user?.role === 'admin' && (
        <AdminPanel
          onNavigateToAsset={handleNavigateToAsset}
          onNavigateToAudit={() => handleNavigate('audit')}
        />
      )}
      {page === 'audit' && user?.role === 'admin' && (
        <AdminAuditLog onNavigateToAsset={handleNavigateToAsset} />
      )}
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

  if (window.location.pathname === '/reset-password') {
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get('token') ?? '';
    return (
      <ResetPassword
        token={resetToken}
        onDone={() => {
          window.history.replaceState(null, '', '/');
          window.location.reload();
        }}
      />
    );
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
