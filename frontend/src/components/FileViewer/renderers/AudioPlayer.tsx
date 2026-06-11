import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface Props {
  url: string;
  filename: string;
  downloadHref: string;
  onError: (err: Error) => void;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ url, filename, downloadHref, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ws = WaveSurfer.create({
      container,
      waveColor: 'rgba(139, 92, 246, 0.4)',
      progressColor: 'rgba(139, 92, 246, 0.8)',
      cursorColor: 'rgba(255,255,255,0.6)',
      height: 48,
      normalize: true,
      interact: true,
    });

    wsRef.current = ws;
    ws.load(url);
    ws.on('ready', () => { setLoading(false); setDuration(ws.getDuration()); });
    ws.on('audioprocess', () => setCurrentTime(ws.getCurrentTime()));
    ws.on('seeking', () => setCurrentTime(ws.getCurrentTime()));
    ws.on('finish', () => setPlaying(false));
    ws.on('error', (e) => onError(new Error(String(e))));

    return () => { ws.destroy(); };
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!wsRef.current) return;
      if (e.key === ' ') { e.preventDefault(); wsRef.current.playPause(); setPlaying((p) => !p); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); wsRef.current.skip(-5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); wsRef.current.skip(5); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setVolume((v) => { const n = Math.min(1, v + 0.1); wsRef.current?.setVolume(n); return n; }); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setVolume((v) => { const n = Math.max(0, v - 0.1); wsRef.current?.setVolume(n); return n; }); }
      else if (e.key === 'm') { setMuted((m) => { const next = !m; wsRef.current?.setMuted(next); return next; }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const togglePlay = () => {
    if (!wsRef.current) return;
    wsRef.current.playPause();
    setPlaying((p) => !p);
  };

  const skip = (s: number) => {
    wsRef.current?.skip(s);
    setCurrentTime(wsRef.current?.getCurrentTime() ?? 0);
  };

  const handleVolume = (v: number) => {
    setVolume(v);
    wsRef.current?.setVolume(v);
    if (v > 0 && muted) { setMuted(false); wsRef.current?.setMuted(false); }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    wsRef.current?.setMuted(next);
  };

  return (
    <div className="flex items-center justify-center flex-1 p-6">
      <div className="card bg-surface-2 p-6 rounded-xl w-full max-w-lg flex flex-col gap-5">
        <p className="text-sm font-medium text-content-primary truncate text-center">{filename}</p>

        {/* Waveform */}
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="w-5 h-5 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
            </div>
          )}
          <div ref={containerRef} className="rounded-lg overflow-hidden" />
        </div>

        {/* Time display */}
        <div className="text-center text-sm text-content-secondary tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        {/* Transport */}
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => skip(-10)} className="btn-ghost btn-sm" aria-label="Rewind 10 seconds">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9l-3 3m0 0l3 3m-3-3h8.25M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
            </svg>
          </button>
          <button
            onClick={togglePlay}
            disabled={loading}
            className="btn-primary w-10 h-10 rounded-full p-0 flex items-center justify-center"
            aria-pressed={playing}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button onClick={() => skip(10)} className="btn-ghost btn-sm" aria-label="Skip forward 10 seconds">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15l3-3m0 0l-3-3m3 3H7.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-3">
          <button onClick={toggleMute} className="btn-ghost btn-sm p-1" aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted || volume === 0 ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531V19.94a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53L6.75 15.75H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => handleVolume(Number(e.target.value))}
            className="flex-1 accent-violet-500"
            aria-label="Volume"
          />
        </div>

        {/* Download */}
        <a href={downloadHref} download={filename} className="btn-secondary btn-sm text-xs self-center" aria-label={`Download ${filename}`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download
        </a>
      </div>
    </div>
  );
}
