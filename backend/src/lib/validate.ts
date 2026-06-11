import { ZodSchema, ZodError } from 'zod';
import type { FastifyReply } from 'fastify';

export function formatZodErrors(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    (out[path] ??= []).push(issue.message);
  }
  return out;
}

export function parseBody<T>(
  schema: ZodSchema<T>,
  data: unknown,
  reply: FastifyReply,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.status(400).send({ error: 'Validation failed', fields: formatZodErrors(result.error) });
    return null;
  }
  return result.data;
}

export function parseParams<T>(
  schema: ZodSchema<T>,
  data: unknown,
  reply: FastifyReply,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.status(400).send({ error: 'Invalid request', fields: formatZodErrors(result.error) });
    return null;
  }
  return result.data;
}
