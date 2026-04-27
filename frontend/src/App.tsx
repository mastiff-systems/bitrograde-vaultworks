import { useEffect, useState } from 'react';
import { DropZone } from './components/DropZone.js';
import { FileList } from './components/FileList.js';
import { LoginPage } from './components/LoginPage.js';
import { KeycloakCallback } from './components/KeycloakCallback.js';
import { useAuth } from './contexts/AuthContext.js';
import { listFiles } from './api/client.js';
import type { Asset } from './api/client.js';

function Dashboard() {
  const { user, logout } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listFiles()
      .then(setAssets)
      .catch(() => setError('Failed to load files.'))
      .finally(() => setLoading(false));
  }, []);

  const handleUploaded = (newAssets: Asset[]) => {
    setAssets((prev) => [...newAssets, ...prev]);
  };

  const handleDeleted = (id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ marginBottom: 32, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, color: '#fff', fontSize: 28, fontWeight: 700 }}>
            Bitrograde Vaultworks
          </h1>
          <p style={{ margin: '4px 0 0', color: '#888', fontSize: 14 }}>
            Digital Asset Management
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#666', fontSize: 13 }}>{user?.email}</span>
          <button
            onClick={logout}
            style={{ background: 'transparent', border: '1px solid #333', borderRadius: 6, color: '#aaa', cursor: 'pointer', fontSize: 13, padding: '6px 14px' }}
          >
            Sign out
          </button>
        </div>
      </header>

      <DropZone onUploaded={handleUploaded} />

      {loading && <p style={{ color: '#888', textAlign: 'center' }}>Loading…</p>}
      {error && <p style={{ color: '#f66', textAlign: 'center' }}>{error}</p>}
      {!loading && !error && (
        <FileList assets={assets} onDeleted={handleDeleted} />
      )}
    </div>
  );
}

export function App() {
  const { token } = useAuth();

  // Handle Keycloak PKCE callback at /auth/callback
  if (window.location.pathname === '/auth/callback') {
    return <KeycloakCallback />;
  }

  if (!token) return <LoginPage />;
  return <Dashboard />;
}
