import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './components/LoginPage.js';
import { KeycloakCallback } from './components/KeycloakCallback.js';
import { Layout } from './components/Layout.js';
import { AssetBrowser } from './pages/AssetBrowser.js';
import { ProfilePage } from './pages/Profile.js';
import { AdminSettings } from './pages/admin/Settings.js';
import { AdminUsers } from './pages/admin/Users.js';
import { TaxonomyManager } from './pages/admin/TaxonomyManager.js';
import { useAuth } from './contexts/AuthContext.js';
import { CategoryProvider } from './contexts/CategoryContext.js';
import type { ReactNode } from 'react';

/** Redirects non-admin users to the dashboard root. */
function AdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppShell() {
  return (
    <CategoryProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<AssetBrowser />} />
          <Route path="/profile" element={<ProfilePage />} />
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
          <Route
            path="/admin/taxonomy"
            element={
              <AdminRoute>
                <TaxonomyManager />
              </AdminRoute>
            }
          />
          {/* Catch-all: unknown paths → dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </CategoryProvider>
  );
}

export function App() {
  const { token } = useAuth();

  return (
    <Routes>
      {/* Keycloak PKCE callback — accessible without a token */}
      <Route path="/auth/callback" element={<KeycloakCallback />} />
      {/* Everything else: gate on auth */}
      <Route path="/*" element={token ? <AppShell /> : <LoginPage />} />
    </Routes>
  );
}
