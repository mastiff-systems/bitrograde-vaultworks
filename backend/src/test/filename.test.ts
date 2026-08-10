import { describe, it, expect } from 'vitest';
import { generateDuplicateName } from '../lib/filename.js';

// ---------------------------------------------------------------------------
// Core naming-scheme tests (MAS-334 acceptance criteria)
// ---------------------------------------------------------------------------
describe('generateDuplicateName — core naming scheme', () => {
  it('first duplicate: report.pdf → report-Copy.pdf', () => {
    expect(generateDuplicateName(['report.pdf'], 'report.pdf')).toBe('report-Copy.pdf');
  });

  it('second duplicate: report-Copy.pdf already exists → report (2).pdf', () => {
    expect(
      generateDuplicateName(['report.pdf', 'report-Copy.pdf'], 'report.pdf'),
    ).toBe('report (2).pdf');
  });

  it('third duplicate: (2) already exists → report (3).pdf', () => {
    expect(
      generateDuplicateName(['report.pdf', 'report-Copy.pdf', 'report (2).pdf'], 'report.pdf'),
    ).toBe('report (3).pdf');
  });

  it('no extension: notes → notes-Copy', () => {
    expect(generateDuplicateName(['notes'], 'notes')).toBe('notes-Copy');
  });

  it('no extension second duplicate: notes-Copy exists → notes (2)', () => {
    expect(generateDuplicateName(['notes', 'notes-Copy'], 'notes')).toBe('notes (2)');
  });

  it('no extension third duplicate: (2) exists → notes (3)', () => {
    expect(
      generateDuplicateName(['notes', 'notes-Copy', 'notes (2)'], 'notes'),
    ).toBe('notes (3)');
  });
});

// ---------------------------------------------------------------------------
// Already-suffixed input (MAS-334: "handles already-suffixed names")
// ---------------------------------------------------------------------------
describe('generateDuplicateName — already-suffixed base names', () => {
  it('duplicating report-Copy.pdf yields report (2).pdf', () => {
    // Existing set includes both the original and the -Copy
    expect(
      generateDuplicateName(['report.pdf', 'report-Copy.pdf'], 'report-Copy.pdf'),
    ).toBe('report (2).pdf');
  });

  it('duplicating report (2).pdf yields report (3).pdf', () => {
    expect(
      generateDuplicateName(['report.pdf', 'report-Copy.pdf', 'report (2).pdf'], 'report (2).pdf'),
    ).toBe('report (3).pdf');
  });

  it('duplicating notes-Copy with existing notes-Copy → notes (2)', () => {
    expect(generateDuplicateName(['notes', 'notes-Copy'], 'notes-Copy')).toBe('notes (2)');
  });
});

// ---------------------------------------------------------------------------
// Suffix placement — must be before the extension
// ---------------------------------------------------------------------------
describe('generateDuplicateName — extension handling', () => {
  it('suffix goes before .pdf, not after', () => {
    const result = generateDuplicateName([], 'document.pdf');
    expect(result).toBe('document-Copy.pdf');
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('handles multi-dot name: archive.tar.gz', () => {
    // Only the final extension (.gz) is treated as the extension
    expect(generateDuplicateName([], 'archive.tar.gz')).toBe('archive.tar-Copy.gz');
  });

  it('handles leading-dot (hidden) files with no real extension', () => {
    expect(generateDuplicateName([], '.gitignore')).toBe('.gitignore-Copy');
  });
});

// ---------------------------------------------------------------------------
// Deeply nested / multiple-round duplications
// ---------------------------------------------------------------------------
describe('generateDuplicateName — deep nesting', () => {
  it('finds next free slot when many (N) variants already exist', () => {
    const existing = [
      'report.pdf',
      'report-Copy.pdf',
      'report (2).pdf',
      'report (3).pdf',
      'report (4).pdf',
    ];
    expect(generateDuplicateName(existing, 'report.pdf')).toBe('report (5).pdf');
  });

  it('empty existingNames always returns the -Copy name', () => {
    expect(generateDuplicateName([], 'anything.png')).toBe('anything-Copy.png');
  });

  it('baseName not in existingNames still returns -Copy', () => {
    // The source file itself need not be in existingNames for the function to work
    expect(generateDuplicateName([], 'report.pdf')).toBe('report-Copy.pdf');
  });
});
