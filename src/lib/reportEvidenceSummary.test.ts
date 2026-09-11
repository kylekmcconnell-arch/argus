import { describe, expect, it } from 'vitest';
import { assessedPoints, recordedCount } from './reportEvidenceSummary';
import type { CompositionRow } from './scoreComposition';
const row: CompositionRow = { axis: 'team', label: 'Team', score: 12, weight: 20, rationale: 'Named team' };
describe('saved evidence summaries', () => {
  it('distinguishes unknown counts, partial metadata and an explicit zero', () => {
    expect(recordedCount([row], 'counterCount')).toBe('Not recorded');
    expect(recordedCount([{ ...row, counterCount: 0 }], 'counterCount')).toBe('0');
    expect(recordedCount([{ ...row, supportCount: 3 }, { ...row, axis: 'product' }], 'supportCount')).toBe('At least 3');
    expect(recordedCount([{ ...row, supportCount: 0 }, row], 'supportCount')).toBe('Not fully recorded');
    expect(recordedCount([{ ...row, supportCount: -1 }], 'supportCount')).toBe('Not recorded');
  });
  it('excludes unassessed, deferred and irrelevant areas from totals and counts', () => {
    const rows: CompositionRow[] = [row, ...(['unassessed', 'deferred', 'not_applicable'] as const).map(applicability => ({ ...row, applicability, supportCount: 9 }))];
    expect(assessedPoints(rows)).toBe(20);
    expect(recordedCount(rows, 'supportCount')).toBe('Not recorded');
  });
});
