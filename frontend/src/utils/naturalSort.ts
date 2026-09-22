// Natural ("numeric-aware") name comparison: "Folder 2" < "Folder 10".
// Collator is constructed once at module level — per-call construction is expensive.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Comparator for objects with a `name` field (folders, categories, ...). */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return naturalCompare(a.name, b.name);
}
