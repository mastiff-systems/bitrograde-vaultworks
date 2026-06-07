import { useEffect, useRef, useState } from 'react';

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

export function VideoPlayer({ url, filename, downloadHref, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    return () => {
      if (videoRef.current) videoRef.current.src = '';
    };
  }, []);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const skip = (s: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + s));
  };

  const handleVolume = (val: number) => {
    setVolume(val);
    if (videoRef.current) videoRef.current.volume = val;
    if (val > 0 && muted) { setMuted(false); if (videoRef.current) videoRef.current.muted = false; }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  };

  const toggleFullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else v.requestFullscreen().catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); skip(5); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); handleVolume(Math.min(1, volume + 0.1)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); handleVolume(Math.max(0, volume - 0.1)); }
      else if (e.key === 'm') { toggleMute(); }
      else if (e.key === 'f') { toggleFullscreen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, volume, muted]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Video */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          src={url}
          className="w-full h-full object-contain"
          preload="metadata"
          aria-label={`Video player for ${filename}`}
          onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
          onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)}
          onEnded={() => setPlaying(false)}
          onError={() => onError(new Error('Video failed to load'))}
        />
      </div>

      {/* Controls */}
      <div className="bg-surface-1 border-t border-border px-5 py-3 flex-shrink-0">
        {/* Progress bar */}
        <div className="relative h-1.5 bg-surface-3 rounded-full mb-3 cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            if (videoRef.current) videoRef.current.currentTime = frac * duration;
          }}
        >
          <div className="absolute inset-y-0 left-0 bg-accent rounded-full" style={{ width: `${progress}%` }} />
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => skip(-10)} className="btn-ghost btn-sm" aria-label="Rewind 10 seconds">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9l-3 3m0 0l3 3m-3-3h8.25M3 12a9 9 0 1118 0 9 9 0 01-18 0z" />
            </svg>
          </button>
          <button
            onClick={toggle}
            className="btn-primary w-8 h-8 rounded-full p-0 flex items-center justify-center"
            aria-pressed={playing}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button onClick={() => skip(10)} className="btn-ghost btn-sm" aria-label="Skip forward 10 seconds">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15l3-3m0 0l-3-3m3 3H7.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          <span className="text-xs text-content-secondary tabular-nums ml-1">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <button onClick={toggleMute} className="btn-ghost btn-sm p-1 ml-auto" aria-label={muted ? 'Unmute' : 'Mute'}>
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
            type="range" min={0} max={1} step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => handleVolume(Number(e.target.value))}
            className="w-20 accent-violet-500"
            aria-label="Volume"
          />
          <button onClick={toggleFullscreen} className="btn-ghost btn-sm" aria-label="Toggle full screen">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          </button>
          <a href={downloadHref} download={filename} className="btn-ghost btn-sm text-xs" aria-label={`Download ${filename}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
