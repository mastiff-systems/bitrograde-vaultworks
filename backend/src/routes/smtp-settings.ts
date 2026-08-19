import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAllSettings, upsertSettings, invalidateSettingsCache, SMTP_KEYS } from '../db/settings.js';
import { requireAdmin } from '../auth/middleware.js';
import { parseBody } from '../lib/validate.js';
import { sendEmail } from '../services/email.service.js';

const MASKED = '••••••••';
const SMTP_SECRET_KEYS = new Set(['smtp_password']);

function maskSmtpSecrets(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    SMTP_KEYS.map((k) => [k, SMTP_SECRET_KEYS.has(k) && settings[k] ? MASKED : (settings[k] ?? '')]),
  );
}

const SmtpSettingsBody = z.object({
  smtp_host: z.string().optional(),
  smtp_port: z.string().optional(),
  smtp_username: z.string().optional(),
  smtp_password: z.string().optional(),
  smtp_from_address: z.string().email().optional(),
  smtp_encryption: z.enum(['none', 'tls', 'starttls']).optional(),
});

const opts = {
  preHandler: [requireAdmin],
  config: { rateLimit: { max: process.env.VITEST ? 10000 : 10, timeWindow: '1 minute' } },
};

export async function smtpSettingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings/smtp
  app.get('/api/settings/smtp', opts, async (_req, reply) => {
    const all = await getAllSettings();
    return reply.send(maskSmtpSecrets(all));
  });

  // POST /api/settings/smtp
  app.post('/api/settings/smtp', opts, async (req, reply) => {
    const body = parseBody(SmtpSettingsBody, req.body, reply);
    if (!body) return;

    const existing = await getAllSettings();
    const updates: Record<string, string> = {};

    for (const key of SMTP_KEYS) {
      const value = (body as Record<string, string | undefined>)[key];
      if (value === undefined) continue;
      if (SMTP_SECRET_KEYS.has(key) && value === MASKED) {
        if (existing[key]) updates[key] = existing[key];
      } else {
        updates[key] = value;
      }
    }

    await upsertSettings(updates);
    invalidateSettingsCache();
    const updated = await getAllSettings();
    return reply.send(maskSmtpSecrets(updated));
  });

  // POST /api/settings/smtp/test
  app.post('/api/settings/smtp/test', opts, async (req, reply) => {
    const adminEmail = req.user.email;
    try {
      await sendEmail({
        to: adminEmail,
        subject: 'VaultWorks SMTP test',
        text: 'This is a test email from VaultWorks. SMTP is configured correctly.',
      });
      return reply.send({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.send({ success: false, error: message });
    }
  });
}
