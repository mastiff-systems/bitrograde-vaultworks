interface Props {
  downloadHref: string;
  filename: string;
}

export function FallbackViewer({ downloadHref, filename }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 px-6">
      <svg
        className="w-16 h-16 text-content-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
        />
      </svg>
      <h3 className="text-base font-semibold text-content-primary">No preview available</h3>
      <p className="text-sm text-content-secondary text-center max-w-xs">
        This file type can't be previewed in the browser.
      </p>
      <a
        href={downloadHref}
        download={filename}
        className="btn-primary"
        aria-label={`Download ${filename}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Download file
      </a>
    </div>
  );
}
