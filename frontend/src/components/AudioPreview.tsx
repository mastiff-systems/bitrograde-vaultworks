import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { downloadUrl } from '../api/client.js';

interface Props {
  assetId: string;
}

export function AudioPreview({ assetId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ws = WaveSurfer.create({
      container,
      waveColor: '#4a9eff',
      progressColor: '#1a5a99',
      cursorColor: '#fff',
      height: 100,
      normalize: true,
      backend: 'WebAudio',
    });

    wsRef.current = ws;
    ws.load(downloadUrl(assetId));
    ws.on('ready', () => setLoading(false));
    ws.on('finish', () => setPlaying(false));

    return () => {
      ws.destroy();
    };
  }, [assetId]);

  const togglePlay = () => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.playPause();
    setPlaying((p) => !p);
  };

  return (
    <div>
      <div ref={containerRef} style={{ marginBottom: 12 }} />
      {loading && <p style={{ color: '#888', textAlign: 'center' }}>Loading waveform…</p>}
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={togglePlay}
          disabled={loading}
          style={{
            padding: '8px 24px', borderRadius: 4, border: 'none',
            background: '#2a6096', color: '#fff', cursor: 'pointer', fontSize: 15,
          }}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
      </div>
    </div>
  );
}
