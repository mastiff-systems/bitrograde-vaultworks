import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { uploadFiles } from '../api/client.js';
import type { Asset } from '../api/client.js';

interface Props {
  onUploaded: (assets: Asset[]) => void;
}

export function DropZone({ onUploaded }: Props) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!acceptedFiles.length) return;
      setUploading(true);
      setError(null);
      setProgress(0);
      try {
        const assets = await uploadFiles(acceptedFiles, setProgress);
        onUploaded(assets);
      } catch {
        setError('Upload failed. Check your connection and try again.');
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [onUploaded],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        {...getRootProps()}
        style={{
          border: `2px dashed ${isDragActive ? '#4a9eff' : '#555'}`,
          borderRadius: 8,
          padding: '32px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          background: isDragActive ? '#1a2a3a' : '#1a1a1a',
          color: '#ccc',
          transition: 'all 0.2s',
        }}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <p>Uploading… {progress}%</p>
        ) : isDragActive ? (
          <p>Drop files here</p>
        ) : (
          <p>Drag & drop files here, or click to select (up to 10 at once)</p>
        )}
      </div>
      {error && <p style={{ color: '#f66', marginTop: 8 }}>{error}</p>}
    </div>
  );
}
