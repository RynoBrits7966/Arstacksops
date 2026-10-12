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

export const SIGNUP_CLOSED_MESSAGE = "New accounts cannot be created while email delivery is unavailable.";
export const EMAIL_ACTION_CLOSED_MESSAGE = "Email delivery is unavailable, so a confirmation or reset link cannot be sent.";

/** Explicit off. Wins over SMTP settings and the local test mailbox. */
export function emailDeliveryDisabled(): boolean {
  return process.env.EMAIL_DELIVERY === "off";
}

/** In-memory mailbox for automated tests. Never treated as delivery in production. */
export function usingTestMailbox(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.EMAIL_DELIVERY === "test";
}

export function canSendEmail(): boolean {
  if (emailDeliveryDisabled()) return false;
  if (usingTestMailbox()) return true;
  return smtpSettings() !== null;
}

/**
 * Production may start without SMTP only when email delivery is explicitly off.
 * The test mailbox never counts as production delivery.
 */
export function productionStartupError(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (!process.env.DATABASE_URL) return "DATABASE_URL is required in production";
  if (!emailDeliveryDisabled() && !smtpSettings()) {
    return "SMTP_HOST, SMTP_PORT=465, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM are required in production";
  }
  return null;
}

export async function deliverAuthEmail(mail: OutboundMail): Promise<void> {
  if (emailDeliveryDisabled()) {
    throw new Error(EMAIL_ACTION_CLOSED_MESSAGE);
  }
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
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    logger: false,
    debug: false,
  });
  try {
    const info = await transport.sendMail({
      from: smtp.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    console.info(smtpSuccessLine(info));
  } catch (error) {
    console.error(smtpFailureLine(error));
    throw new Error("The message could not be sent.");
  }
}

/** Safe SMTP diagnostics. Omits passwords, URLs, tokens, and message bodies. */
export function smtpSuccessLine(info: { response?: unknown }): string {
  const response = typeof info.response === "string" ? sanitizeSmtpText(info.response) : "none";
  return `smtp send ok response=${response || "none"}`;
}

export function smtpFailureLine(error: unknown): string {
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const code = typeof record.code === "string" && record.code ? record.code : "unknown";
  const responseCode = typeof record.responseCode === "number" ? String(record.responseCode) : "none";
  const command = smtpCommand(record.command);
  const detail = typeof record.response === "string" ? record.response : typeof record.message === "string" ? record.message : "";
  return `smtp send failed code=${code} responseCode=${responseCode} command=${command} message=${sanitizeSmtpText(detail) || "none"}`;
}

function smtpCommand(value: unknown): string {
  if (typeof value !== "string") return "none";
  const word = value.trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-z]+$/.test(word) ? word.toUpperCase() : "none";
}

export function sanitizeSmtpText(value: string): string {
  const password = process.env.SMTP_PASSWORD ?? "";
  let text = value.replace(/[\r\n]+/g, " ");
  text = text.replace(/https?:\/\/\S+/gi, "[url]");
  text = text.replace(/([?&](?:token|callbackURL)=)[^&\s]+/gi, "$1[redacted]");
  if (password) text = text.split(password).join("[redacted]");
  return text.slice(0, 300);
}

export function capturedMail(): OutboundMail[] {
  return captured;
}

export function clearMailbox(): void {
  captured.splice(0, captured.length);
}
