import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FallbackViewer } from '../components/FileViewer/renderers/FallbackViewer.js';

describe('FallbackViewer', () => {
  function renderFallback(filename = 'unknown.exe', downloadHref = '/download/xyz') {
    return render(<FallbackViewer filename={filename} downloadHref={downloadHref} />);
  }

  it('shows "No preview available" heading', () => {
    renderFallback();
    expect(screen.getByRole('heading', { name: /no preview available/i })).toBeInTheDocument();
  });

  it('tells the user the file cannot be previewed in the browser', () => {
    renderFallback();
    expect(screen.getByText(/can't be previewed in the browser/i)).toBeInTheDocument();
  });

  it('renders a "Download file" CTA link', () => {
    renderFallback('program.exe', '/download/abc');
    // The aria-label is "Download program.exe"; match by visible text instead
    expect(screen.getByText('Download file').closest('a')).toBeInTheDocument();
  });

  it('download link points to the provided href', () => {
    renderFallback('report.psd', '/download/def456');
    expect(screen.getByText('Download file').closest('a')).toHaveAttribute('href', '/download/def456');
  });

  it('download link has the filename as the download attribute', () => {
    renderFallback('scene.blend', '/download/ghi789');
    expect(screen.getByText('Download file').closest('a')).toHaveAttribute('download', 'scene.blend');
  });

  it('download link has an accessible aria-label containing the filename', () => {
    renderFallback('weird.unknownext', '/download/jkl');
    // aria-label is authoritative for AT; verify it includes the filename
    const link = screen.getByText('Download file').closest('a')!;
    expect(link).toHaveAttribute('aria-label', 'Download weird.unknownext');
  });
});
