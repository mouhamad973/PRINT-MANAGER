import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Valide une entrée avec un schéma Zod de `@arksen/validation`, le même que celui du frontend.
 * Seule la valeur analysée atteint le contrôleur : les champs inconnus sont écartés.
 */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Données invalides.',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}

/** Décrit un schéma Zod dans le document OpenAPI. */
export function openApiSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as SchemaObject;
}
