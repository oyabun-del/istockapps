import type { z } from 'zod';
import { AppError } from '../lib/app-error.js';

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? `${first.path.join('.')}: ` : '';
    throw new AppError('VALIDATION_ERROR', `Некорректные данные (${where}${first?.message ?? 'invalid'})`);
  }
  return result.data;
}
