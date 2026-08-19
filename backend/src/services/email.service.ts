import nodemailer from 'nodemailer';
import { getAllSettings } from '../db/settings.js';

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(opts: EmailOptions): Promise<void> {
  const settings = await getAllSettings();

  const port = parseInt(settings['smtp_port'] ?? '587', 10);
  const transporter = nodemailer.createTransport({
    host: settings['smtp_host'],
    port,
    secure: settings['smtp_encryption'] === 'tls',
    auth: settings['smtp_username']
      ? { user: settings['smtp_username'], pass: settings['smtp_password'] }
      : undefined,
  });

  await transporter.sendMail({
    from: settings['smtp_from_address'],
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}
