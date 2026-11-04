import { Prisma } from '@arksen/database';

type Comparable = Record<string, unknown>;

function normalize(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

/** Champs réellement modifiés, avec leur ancienne et leur nouvelle valeur, pour le journal d'audit. */
export function diffChanges(
  keys: readonly string[],
  before: Comparable,
  after: Comparable,
): Record<string, { from: unknown; to: unknown }> {
  return Object.fromEntries(
    keys
      .filter((key) => normalize(before[key]) !== normalize(after[key]))
      .map((key) => [key, { from: normalize(before[key]), to: normalize(after[key]) }]),
  );
}

/** Violation d'une contrainte d'unicité. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
