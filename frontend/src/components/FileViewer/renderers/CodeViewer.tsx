import { useEffect, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import plaintext from 'highlight.js/lib/languages/plaintext';
import 'highlight.js/styles/github-dark.min.css';

hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('plaintext', plaintext);

const EXT_LANG: Record<string, string> = {
  json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml',
  svg: 'xml', html: 'xml', md: 'plaintext', txt: 'plaintext', csv: 'plaintext',
};

const SIZE_LIMIT = 500 * 1024;

interface Props {
  url: string;
  filename: string;
  downloadHref: string;
  onError: (err: Error) => void;
}

export function CodeViewer({ url, filename, downloadHref, onError }: Props) {
  const [code, setCode] = useState('');
  const [highlighted, setHighlighted] = useState('');
  const [lineCount, setLineCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const lang = EXT_LANG[ext] ?? 'plaintext';

  useEffect(() => {
    const ac = new AbortController();
    fetch(url, { signal: ac.signal })
      .then(async (res) => {
        const buf = await res.arrayBuffer();
        const wasTruncated = buf.byteLength > SIZE_LIMIT;
        const slice = wasTruncated ? buf.slice(0, SIZE_LIMIT) : buf;
        const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
        setCode(text);
        setTruncated(wasTruncated);
        setLineCount(text.split('\n').length);
        try {
          const result = hljs.highlight(text, { language: lang });
          setHighlighted(result.value);
        } catch {
          setHighlighted(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        }
        setLoading(false);
      })
      .catch((e) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        onError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });
    return () => ac.abort();
  }, [url, lang]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1" role="status" aria-label="Loading file preview">
        <div className="w-8 h-8 rounded-full border-2 border-surface-4 border-t-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {truncated && (
        <div className="px-5 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-300 flex-shrink-0">
          Showing first 500 KB — download for the full file.
        </div>
      )}
      <div className="flex-1 bg-surface-0 overflow-auto">
        <pre
          role="region"
          aria-label={`File contents: ${filename}`}
          className="font-mono text-sm leading-6 p-5 text-content-primary whitespace-pre m-0"
        >
          <code
            className={`language-${lang}`}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </div>

      {/* Footer */}
      <div className="bg-surface-1 border-t border-border px-5 py-3 flex items-center gap-4 flex-shrink-0 text-xs">
        <span className="text-content-secondary uppercase tracking-wide">{ext.toUpperCase() || 'TXT'}</span>
        <span className="text-content-muted">•</span>
        <span className="text-content-secondary tabular-nums">{lineCount} lines</span>
        <a href={downloadHref} download={filename} className="btn-ghost btn-sm text-xs ml-auto" aria-label="Download file">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download
        </a>
        <button onClick={copy} className="btn-ghost btn-sm text-xs" aria-label="Copy to clipboard">
          {copied ? (
            <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
            </svg>
          )}
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <span role="status" aria-live="polite" className="sr-only">{copied ? 'Copied to clipboard' : ''}</span>
      </div>
    </div>
  );
}
