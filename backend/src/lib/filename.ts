/**
 * Utilities for generating non-conflicting duplicate filenames.
 *
 * Naming scheme (suffix inserted before the file extension):
 *   First copy:      {name}-Copy.{ext}
 *   Further copies:  {name} (2).{ext}, {name} (3).{ext}, …
 *
 * Files with no extension follow the same pattern without the dot:
 *   notes → notes-Copy → notes (2) → …
 */

/**
 * Split a filename into stem and extension.
 *
 *   'report.pdf'  → { stem: 'report',     ext: '.pdf' }
 *   'notes'       → { stem: 'notes',      ext: '' }
 *   '.gitignore'  → { stem: '.gitignore', ext: '' }   (leading-dot = no extension)
 *   'a.b.c'       → { stem: 'a.b',        ext: '.c' }
 */
function parseName(name: string): { stem: string; ext: string } {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, lastDot), ext: name.slice(lastDot) };
}

/**
 * Strip duplicate-generation suffixes from a stem to recover the canonical base.
 *
 *   'report-Copy'  → 'report'
 *   'report (2)'   → 'report'
 *   'report (3)'   → 'report'
 *   'report'       → 'report'
 *
 * Handles deeply nested cases such as 'report (2) (3)' by stripping
 * numeric suffixes recursively before stripping '-Copy'.
 */
function getCoreStem(stem: string): string {
  // Strip trailing ' (N)' where N is any positive integer
  const numMatch = stem.match(/^(.*) \(\d+\)$/);
  if (numMatch) return getCoreStem(numMatch[1]);

  // Strip trailing '-Copy'
  if (stem.endsWith('-Copy')) return stem.slice(0, '-Copy'.length * -1);

  return stem;
}

/**
 * Generate a non-conflicting name for a duplicate of `baseName`.
 *
 * @param existingNames - The full set of names already present in the same location.
 * @param baseName      - The original filename being duplicated.
 * @returns A unique name that does not appear in `existingNames`.
 *
 * @example
 *   generateDuplicateName(['report.pdf'], 'report.pdf')
 *   // → 'report-Copy.pdf'
 *
 *   generateDuplicateName(['report.pdf', 'report-Copy.pdf'], 'report.pdf')
 *   // → 'report (2).pdf'
 *
 *   generateDuplicateName(['notes'], 'notes')
 *   // → 'notes-Copy'
 */
export function generateDuplicateName(existingNames: string[], baseName: string): string {
  const existing = new Set(existingNames);
  const { stem, ext } = parseName(baseName);
  const core = getCoreStem(stem);

  // Try the '-Copy' variant first
  const copyName = `${core}-Copy${ext}`;
  if (!existing.has(copyName)) return copyName;

  // Find the smallest N ≥ 2 whose slot is free
  for (let n = 2; ; n++) {
    const candidate = `${core} (${n})${ext}`;
    if (!existing.has(candidate)) return candidate;
  }
}
