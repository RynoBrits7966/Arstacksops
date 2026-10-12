import nodemailer from "nodemailer";

export interface OutboundMail {
  to: string;
  subject: string;
  url: string;
  text: string;
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

const captured: OutboundMail[] = [];

/**
 * Port 465 is implicit TLS from the first byte. Other ports are rejected
 * so the server cannot fall back to a clear-text or STARTTLS connection.
 * Certificate validation stays at Node's default (rejectUnauthorized).
 */
export function smtpSettings(): SmtpSettings | null {
  const host = process.env.SMTP_HOST?.trim() ?? "";
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER?.trim() ?? "";
  const password = process.env.SMTP_PASSWORD ?? "";
  const from = process.env.SMTP_FROM?.trim() ?? "";
  if (!host || port !== 465 || !user || !password || !from) return null;
  return { host, port, user, password, from };
}

/** In-memory mailbox for automated tests. Never treated as delivery in production. */
export function usingTestMailbox(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.EMAIL_DELIVERY === "test";
}

export function canSendEmail(): boolean {
  if (usingTestMailbox()) return true;
  return smtpSettings() !== null;
}

export async function deliverAuthEmail(mail: OutboundMail): Promise<void> {
  if (usingTestMailbox()) {
    captured.push(mail);
    return;
  }
  const smtp = smtpSettings();
  if (!smtp) {
    throw new Error("Email delivery is not configured, so this message cannot be sent yet.");
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: true,
    auth: {
      user: smtp.user,
      pass: smtp.password,
    },
    tls: {
      rejectUnauthorized: true,
      servername: smtp.host,
    },
  });
  try {
    await transport.sendMail({
      from: smtp.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  } catch {
    throw new Error("The message could not be sent.");
  }
}

export function capturedMail(): OutboundMail[] {
  return captured;
}

export function clearMailbox(): void {
  captured.splice(0, captured.length);
}
