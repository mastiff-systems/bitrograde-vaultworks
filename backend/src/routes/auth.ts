import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { signToken } from '../auth/tokens.js';
import { authenticate } from '../auth/middleware.js';
import { parseBody } from '../lib/validate.js';
import { sendEmail } from '../services/email.service.js';

const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const ForgotPasswordBody = z.object({
  email: z.string().email('Invalid email address'),
});

const ResetPasswordBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  if ((process.env.AUTH_PROVIDER ?? 'local') !== 'local') return;

  // Warn at startup if APP_URL is not HTTPS in production — reset links would be sent over HTTP
  const _startupAppUrl = process.env.APP_URL ?? 'http://localhost:5173';
  if (process.env.NODE_ENV === 'production' && !_startupAppUrl.startsWith('https://')) {
    app.log.warn('APP_URL is not HTTPS in production — reset links will use HTTP');
  }

  app.post('/api/auth/register', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
        },
      },
    },
    config: {
      rateLimit: {
        max: process.env.VITEST ? 10000 : 5,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
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

  app.post('/api/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
    config: {
      rateLimit: {
        max: process.env.VITEST ? 10000 : 10,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const body = parseBody(LoginSchema, req.body, reply);
    if (!body) return;

    const email = body.email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, role: true, mustChangePassword: true },
    });

    const dummyHash = '$2a$12$invalidhashpadding.............';
    const valid = user
      ? await bcrypt.compare(body.password, user.passwordHash)
      : await bcrypt.compare(body.password, dummyHash).then(() => false);

    if (!user || !valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role as 'admin' | 'user' });
    return reply.send({ token, user: { id: user.id, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword } });
  });

  app.get('/api/auth/me', { preHandler: [authenticate] }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { mustChangePassword: true },
    });
    return reply.send({ ...req.user, mustChangePassword: user?.mustChangePassword ?? false });
  });

  // POST /api/auth/forgot-password
  app.post('/api/auth/forgot-password', {
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(ForgotPasswordBody, req.body, reply);
    if (!body) return;

    const MIN_RESPONSE_MS = 300;
    const start = Date.now();

    const email = body.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: tokenHash,
          passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
      if (process.env.NODE_ENV === 'production' && !appUrl.startsWith('https://')) {
        app.log.warn('APP_URL is not HTTPS in production — reset links will use HTTP');
      }
      try {
        await sendEmail({
          to: user.email,
          subject: 'Password reset',
          text: `Reset your password: ${appUrl}/reset-password?token=${rawToken}\nThis link expires in 1 hour.`,
        });
      } catch {
        // swallow SMTP errors — do not leak config status
      }
    }

    const elapsed = Date.now() - start;
    if (elapsed < MIN_RESPONSE_MS) await new Promise(r => setTimeout(r, MIN_RESPONSE_MS - elapsed));

    return reply.send({ message: 'If that email exists, a reset link has been sent.' });
  });

  // POST /api/auth/reset-password
  app.post('/api/auth/reset-password', {
    config: { rateLimit: { max: process.env.VITEST ? 10000 : 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(ResetPasswordBody, req.body, reply);
    if (!body) return;

    const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');
    const user = await prisma.user.findFirst({
      where: { passwordResetToken: tokenHash },
      select: { id: true, passwordResetExpiresAt: true },
    });

    if (!user) {
      return reply.status(400).send({ error: 'Invalid or expired reset token' });
    }

    if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      return reply.status(400).send({ error: 'Invalid or expired reset token' });
    }

    const newHash = await bcrypt.hash(body.password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      },
    });

    return reply.send({ message: 'Password has been reset.' });
  });
}
