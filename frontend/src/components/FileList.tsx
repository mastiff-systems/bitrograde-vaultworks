import { useState } from 'react';
import type { Asset } from '../api/client.js';
import { deleteFile, downloadUrl } from '../api/client.js';
import { Preview3D } from './Preview3D.js';
import { AudioPreview } from './AudioPreview.js';

interface Props {
  assets: Asset[];
  onDeleted: (id: string) => void;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function FileList({ assets, onDeleted, selectionMode, selectedIds, onToggleSelect }: Props) {
  const [previewing, setPreviewing] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const allSelected = assets.length > 0 && assets.every((a) => selectedIds?.has(a.id));

  function toggleAll() {
    if (allSelected) {
      assets.forEach((a) => selectedIds?.has(a.id) && onToggleSelect?.(a.id));
    } else {
      assets.forEach((a) => !selectedIds?.has(a.id) && onToggleSelect?.(a.id));
    }
  }

  const handleDelete = async (asset: Asset) => {
    if (!confirm(`Delete "${asset.original_name}"?`)) return;
    setDeleting(asset.id);
    try {
      await deleteFile(asset.id);
      onDeleted(asset.id);
    } catch {
      alert('Delete failed.');
    } finally {
      setDeleting(null);
    }
  };

  if (!assets.length) {
    return <p style={{ color: '#888', textAlign: 'center' }}>No files uploaded yet.</p>;
  }

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', color: '#ddd' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333' }}>
            {selectionMode && (
              <th style={th}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer' }}
                  aria-label="Select all"
                />
              </th>
            )}
            <th style={th}>Name</th>
            <th style={th}>Type</th>
            <th style={th}>Size</th>
            <th style={th}>Uploaded</th>
            <th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr
              key={a.id}
              style={{
                borderBottom: '1px solid #222',
                background: selectedIds?.has(a.id) ? 'rgba(99,102,241,0.08)' : undefined,
              }}
            >
              {selectionMode && (
                <td style={td}>
                  <input
                    type="checkbox"
                    checked={selectedIds?.has(a.id) ?? false}
                    onChange={() => onToggleSelect?.(a.id)}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
              )}
              <td style={td}>{a.original_name}</td>
              <td style={td}>
                <span style={{ ...badge, background: typeColor(a.asset_type) }}>
                  {a.asset_type}
                </span>
              </td>
              <td style={td}>{formatBytes(a.size_bytes ?? 0)}</td>
              <td style={td}>{formatDate(a.uploaded_at)}</td>
              <td style={td}>
                <button style={btnPrimary} onClick={() => setPreviewing(a)}
                  disabled={a.asset_type !== '3d' && a.asset_type !== 'audio'}>
                  Preview
                </button>
                {' '}
                <a
                  href={downloadUrl(a.id)}
                  style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-block' }}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
                {' '}
                <button
                  style={btnDanger}
                  disabled={deleting === a.id}
                  onClick={() => handleDelete(a)}
                >
                  {deleting === a.id ? '…' : 'Delete'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {previewing && (
        <div style={modal}>
          <div style={modalInner}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong style={{ color: '#fff' }}>{previewing.original_name}</strong>
              <button style={btnClose} onClick={() => setPreviewing(null)}>✕</button>
            </div>
            {previewing.asset_type === '3d' ? (
              <Preview3D assetId={previewing.id} filename={previewing.original_name} />
            ) : (
              <AudioPreview assetId={previewing.id} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', color: '#aaa', fontWeight: 500 };
const td: React.CSSProperties = { padding: '8px 12px' };
const badge: React.CSSProperties = { padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 };
const btnPrimary: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 4, border: 'none', background: '#2a6096',
  color: '#fff', cursor: 'pointer', fontSize: 13,
};
const btnDanger: React.CSSProperties = { ...btnPrimary, background: '#882222' };
const btnClose: React.CSSProperties = { ...btnPrimary, background: '#444' };
const modal: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalInner: React.CSSProperties = {
  background: '#1a1a1a', borderRadius: 8, padding: 24,
  minWidth: 400, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto',
};

function typeColor(type: Asset['asset_type']): string {
  switch (type) {
    case '3d': return '#2d6a3f';
    case 'audio': return '#6a2d2d';
    case 'image': return '#2d4a6a';
    default: return '#444';
  }
}
