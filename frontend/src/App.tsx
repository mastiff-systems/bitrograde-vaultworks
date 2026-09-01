import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LoginPage } from './components/LoginPage.js';
import { KeycloakCallback } from './components/KeycloakCallback.js';
import { Layout } from './components/Layout.js';
import { AssetBrowser } from './pages/AssetBrowser.js';
import { ProfilePage } from './pages/Profile.js';
import { AdminSettings } from './pages/admin/Settings.js';
import { AdminUsers } from './pages/admin/Users.js';
import { Collections } from './pages/Collections.js';
import { ResetPassword } from './pages/ResetPassword.js';
import { ChangePassword } from './pages/ChangePassword.js';
import { useAuth } from './contexts/AuthContext.js';
import { CategoryProvider } from './contexts/CategoryContext.js';
import { UploadProvider } from './contexts/UploadContext.js';
import type { ReactNode } from 'react';

/** Redirects non-admin users to the dashboard root. */
function AdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Dashboard route: `/?asset=<id>` opens that asset's details panel
    (used by the Settings → Logs asset click-through, MAS-736). */
function AssetBrowserRoute() {
  const location = useLocation();
  const assetId = new URLSearchParams(location.search).get('asset');
  return <AssetBrowser initialDetailAssetId={assetId} />;
}

function AppShell() {
  return (
    <CategoryProvider>
      <UploadProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<AssetBrowserRoute />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/collections" element={<Collections />} />
            <Route
              path="/admin/settings"
              element={
                <AdminRoute>
                  <AdminSettings />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/users"
              element={
                <AdminRoute>
                  <AdminUsers />
                </AdminRoute>
              }
            />
            {/* Catch-all: unknown paths → dashboard */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </UploadProvider>
    </CategoryProvider>
  );
}

export function App() {
  const { token, mustChangePassword } = useAuth();

  return (
    <Routes>
      {/* Keycloak PKCE callback — accessible without a token */}
      <Route path="/auth/callback" element={<KeycloakCallback />} />
      {/* Password reset — accessible without a token */}
      <Route path="/reset-password" element={<ResetPassword token={new URLSearchParams(window.location.search).get('token') ?? ''} onDone={() => { window.history.replaceState(null, '', '/'); window.location.reload(); }} />} />
      {/* Everything else: gate on auth, then on the forced password change (MAS-626) —
          the backend 403s all protected routes while mustChangePassword is set */}
      <Route path="/*" element={token ? (mustChangePassword ? <ChangePassword /> : <AppShell />) : <LoginPage />} />
    </Routes>
  );
}
