import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { signToken } from '../auth/tokens.js';
import { authenticate } from '../auth/middleware.js';
import { parseBody } from '../lib/validate.js';
import { logAudit, AuditAction } from '../lib/audit.js';

const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const UpdateProfileSchema = z.object({
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  if ((process.env.AUTH_PROVIDER ?? 'local') !== 'local') return;

  app.post('/api/auth/register', async (req, reply) => {
    const body = parseBody(RegisterSchema, req.body, reply);
    if (!body) return;

    const email = body.email.trim().toLowerCase();
    const hash = await bcrypt.hash(body.password, 12);

    // First user becomes admin
    const count = await prisma.user.count();
    const role = count === 0 ? 'admin' : 'user';

    try {
      const user = await prisma.user.create({
        data: { email, passwordHash: hash, role },
        select: { id: true, email: true, role: true },
      });
      const token = signToken({ userId: user.id, email: user.email, role: user.role as 'admin' | 'user' });
      return reply.status(201).send({ token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'Email already registered' });
      }
      throw err;
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parseBody(LoginSchema, req.body, reply);
    if (!body) return;

    const email = body.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, role: true },
    });

    const dummyHash = '$2a$12$invalidhashpadding.............';
    const valid = user
      ? await bcrypt.compare(body.password, user.passwordHash)
      : await bcrypt.compare(body.password, dummyHash).then(() => false);

    if (!user || !valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role as 'admin' | 'user' });

    void logAudit({
      userId: user.id,
      action: AuditAction.LOGIN,
      ipAddress: req.ip,
    });

    return reply.send({ token, user: { id: user.id, email: user.email, role: user.role } });
  });

  app.post('/api/auth/logout', { preHandler: [authenticate] }, async (req, reply) => {
    void logAudit({
      userId: req.user.userId,
      action: AuditAction.LOGOUT,
      ipAddress: req.ip,
    });
    return reply.status(204).send();
  });

  app.get('/api/auth/me', { preHandler: [authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, role: true, firstName: true, lastName: true },
    });
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    return reply.send({
      userId: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  });

  app.patch('/api/auth/profile', { preHandler: [authenticate] }, async (req, reply) => {
    const body = parseBody(UpdateProfileSchema, req.body, reply);
    if (!body) return;

    const updated = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        ...(body.firstName !== undefined && { firstName: body.firstName }),
        ...(body.lastName !== undefined && { lastName: body.lastName }),
      },
      select: { id: true, email: true, role: true, firstName: true, lastName: true },
    });

    return reply.send({
      userId: updated.id,
      email: updated.email,
      role: updated.role,
      firstName: updated.firstName,
      lastName: updated.lastName,
    });
  });
}
