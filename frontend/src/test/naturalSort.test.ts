/**
 * MAS-839: Natural (numeric-aware) sort for folder / category / asset name
 * lists. "Folder 10" must sort after "Folder 2", not between "Folder 1" and
 * "Folder 2" as plain lexicographic localeCompare does.
 */
import { describe, it, expect } from 'vitest';
import { naturalCompare, byName } from '../utils/naturalSort';

describe('naturalCompare', () => {
  it('orders embedded numbers numerically, not lexicographically', () => {
    const names = ['Folder 10', 'Folder 2', 'Folder 1', 'Folder 11'];
    expect([...names].sort(naturalCompare)).toEqual([
      'Folder 1',
      'Folder 2',
      'Folder 10',
      'Folder 11',
    ]);
  });

  it('is case-insensitive', () => {
    expect(naturalCompare('folder 2', 'Folder 2')).toBe(0);
    expect([...['FOLDER 10', 'folder 2']].sort(naturalCompare)).toEqual([
      'folder 2',
      'FOLDER 10',
    ]);
  });

  it('falls back to alphabetical order for non-numeric names', () => {
    expect([...['banana', 'Apple', 'cherry']].sort(naturalCompare)).toEqual([
      'Apple',
      'banana',
      'cherry',
    ]);
  });
});

describe('byName', () => {
  it('sorts objects with a name field naturally', () => {
    const folders = [
      { name: 'Folder 11' },
      { name: 'Folder 1' },
      { name: 'Folder 10' },
      { name: 'Folder 2' },
    ];
    expect([...folders].sort(byName).map((f) => f.name)).toEqual([
      'Folder 1',
      'Folder 2',
      'Folder 10',
      'Folder 11',
    ]);
  });
});
