import { describe, expect, it } from 'vitest';
import { durationLabel } from './administration-page';

describe('durationLabel', () => {
  it('exprime une durée de conservation en années, en mois ou en jours', () => {
    expect(durationLabel(365)).toBe('1 an');
    expect(durationLabel(1095)).toBe('3 ans');
    expect(durationLabel(180)).toBe('6 mois');
    expect(durationLabel(45)).toBe('45 jours');
  });
});
