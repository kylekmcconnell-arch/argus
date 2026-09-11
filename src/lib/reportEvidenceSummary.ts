import type { CompositionRow } from './scoreComposition';

/** Counts describe saved references, not distinct sources or verification quality. */
export function recordedCount(rows: CompositionRow[], key: 'supportCount' | 'counterCount'): string {
  const assessed = rows.filter(row => row.applicability === undefined);
  const counts = assessed.map(row => row[key]).filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0);
  if (!counts.length) return 'Not recorded';
  const sum = counts.reduce((total, value) => total + value, 0);
  return counts.length === assessed.length ? String(sum) : sum > 0 ? `At least ${sum}` : 'Not fully recorded';
}

export function assessedPoints(rows: CompositionRow[]): number {
  return rows.filter(row => row.applicability === undefined).reduce((total, row) => total + row.weight, 0);
}
