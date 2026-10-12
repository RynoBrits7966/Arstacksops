import { afterEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.hoisted(() => vi.fn(async (): Promise<{ messageId: string; response?: string }> => ({ messageId: "mock-id" })));
const createTransport = vi.hoisted(() => vi.fn(() => ({ sendMail })));

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

import { EMAIL_ACTION_CLOSED_MESSAGE, canSendEmail, capturedMail, clearMailbox, deliverAuthEmail, emailDeliveryDisabled, productionStartupError, sanitizeSmtpText, smtpFailureLine, smtpSuccessLine, smtpSettings, usingTestMailbox } from "./mail";

const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "EMAIL_DELIVERY", "NODE_ENV", "DATABASE_URL"] as const;

describe("SMTP delivery", () => {
  const previous = Object.fromEntries(smtpKeys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of smtpKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    sendMail.mockClear();
    createTransport.mockClear();
    clearMailbox();
  });

  it("keeps mail closed until host, port 465, user, password, and from are all set", () => {
    process.env.NODE_ENV = "test";
    process.env.EMAIL_DELIVERY = "";
    process.env.SMTP_HOST = "mail.arstacks.co.za";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "barend@arstacks.co.za";
    process.env.SMTP_FROM = "barend@arstacks.co.za";
    delete process.env.SMTP_PASSWORD;
    expect(smtpSettings()).toBeNull();
    expect(canSendEmail()).toBe(false);
  });

  it("rejects a port that is not implicit TLS", () => {
    process.env.NODE_ENV = "test";
    process.env.EMAIL_DELIVERY = "";
    process.env.SMTP_HOST = "mail.arstacks.co.za";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "barend@arstacks.co.za";
    process.env.SMTP_PASSWORD = "test-only-not-a-mailbox-password";
    process.env.SMTP_FROM = "barend@arstacks.co.za";
    expect(canSendEmail()).toBe(false);
  });

  it("hands a verification message to SMTP on port 465 with certificate checks on", async () => {
    process.env.NODE_ENV = "test";
    process.env.EMAIL_DELIVERY = "";
    process.env.SMTP_HOST = "mail.arstacks.co.za";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "barend@arstacks.co.za";
    process.env.SMTP_PASSWORD = "test-only-not-a-mailbox-password";
    process.env.SMTP_FROM = "barend@arstacks.co.za";

    sendMail.mockResolvedValueOnce({
      messageId: "mock-id",
      response: "250 OK https://app.example/api/auth/verify-email?token=abc test-only-not-a-mailbox-password",
    });
    const notes: unknown[][] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => {
      notes.push(args);
    };
    try {
      await deliverAuthEmail({
        to: "andrew@arstacks.co.za",
        subject: "Confirm your ARStacksOps account",
        url: "https://app.example/api/auth/verify-email?token=abc",
        text: "Confirm your account: https://app.example/api/auth/verify-email?token=abc",
      });
    } finally {
      console.info = original;
    }
    const line = String(notes[0]?.[0] ?? "");
    expect(line).toBe(smtpSuccessLine({
      response: "250 OK https://app.example/api/auth/verify-email?token=abc test-only-not-a-mailbox-password",
    }));
    expect(line).not.toContain("token=abc");
    expect(line).not.toContain("test-only-not-a-mailbox-password");
    expect(line).not.toContain("Confirm your account");

    expect(createTransport).toHaveBeenCalledWith({
      host: "mail.arstacks.co.za",
      port: 465,
      secure: true,
      auth: {
        user: "barend@arstacks.co.za",
        pass: "test-only-not-a-mailbox-password",
      },
      tls: {
        rejectUnauthorized: true,
        servername: "mail.arstacks.co.za",
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      logger: false,
      debug: false,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "barend@arstacks.co.za",
      to: "andrew@arstacks.co.za",
      subject: "Confirm your ARStacksOps account",
      text: "Confirm your account: https://app.example/api/auth/verify-email?token=abc",
    });
    expect(capturedMail()).toHaveLength(0);
  });

  it("uses the in-memory mailbox only when EMAIL_DELIVERY=test and does not open SMTP", async () => {
    process.env.NODE_ENV = "test";
    process.env.EMAIL_DELIVERY = "test";
    process.env.SMTP_HOST = "mail.arstacks.co.za";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "barend@arstacks.co.za";
    process.env.SMTP_PASSWORD = "test-only-not-a-mailbox-password";
    process.env.SMTP_FROM = "barend@arstacks.co.za";
    expect(usingTestMailbox()).toBe(true);

    await deliverAuthEmail({
      to: "one@arstacks.test",
      subject: "Confirm your ARStacksOps account",
      url: "http://localhost:5173/api/auth/verify-email?token=abc",
      text: "Confirm your account: http://localhost:5173/api/auth/verify-email?token=abc",
    });

    expect(createTransport).not.toHaveBeenCalled();
    expect(capturedMail()).toHaveLength(1);
  });

  it("logs the SMTP code and response code without secrets or the message body", async () => {
    process.env.NODE_ENV = "test";
    process.env.EMAIL_DELIVERY = "";
    process.env.SMTP_HOST = "mail.arstacks.co.za";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "barend@arstacks.co.za";
    process.env.SMTP_PASSWORD = "test-only-not-a-mailbox-password";
    process.env.SMTP_FROM = "barend@arstacks.co.za";
    const failure = Object.assign(new Error("Invalid login: 535 5.7.8 authentication failed"), {
      code: "EAUTH",
      responseCode: 535,
      command: "AUTH PLAIN dGVzdC1vbmx5LW5vdC1hLW1haWxib3gtcGFzc3dvcmQ=",
      response: "535 5.7.8 authentication failed for test-only-not-a-mailbox-password",
    });
    sendMail.mockRejectedValueOnce(failure);
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      await expect(
        deliverAuthEmail({
          to: "andrew@arstacks.co.za",
          subject: "Confirm your ARStacksOps account",
          url: "https://arstacksops-production.up.railway.app/api/auth/verify-email?token=secret-token&callbackURL=%2F",
          text: "Confirm your account: https://arstacksops-production.up.railway.app/api/auth/verify-email?token=secret-token",
        }),
      ).rejects.toThrow("The message could not be sent.");
    } finally {
      console.error = original;
    }
    const line = String(errors[0]?.[0] ?? "");
    expect(line).toBe(smtpFailureLine(failure));
    expect(line).toContain("code=EAUTH");
    expect(line).toContain("responseCode=535");
    expect(line).toContain("command=AUTH");
    expect(line).not.toContain("test-only-not-a-mailbox-password");
    expect(line).not.toContain("secret-token");
    expect(line).not.toContain("verify-email");
    expect(line).not.toContain("Confirm your account");
    expect(sanitizeSmtpText("see https://arstacksops-production.up.railway.app/api/auth/verify-email?token=secret-token")).toBe(
      "see [url]",
    );
  });

  it("treats an explicit off switch as closed even when SMTP settings are present", async () => {
    process.env.NODE_ENV = "production";
    process.env.EMAIL_DELIVERY = "off";
    process.env.DATABASE_URL = "postgres://example";
    process.env.SMTP_HOST = "mail.arstacks.co.za";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "barend@arstacks.co.za";
    process.env.SMTP_PASSWORD = "test-only-not-a-mailbox-password";
    process.env.SMTP_FROM = "barend@arstacks.co.za";
    expect(emailDeliveryDisabled()).toBe(true);
    expect(canSendEmail()).toBe(false);
    expect(productionStartupError()).toBeNull();
    await expect(
      deliverAuthEmail({
        to: "andrew@arstacks.co.za",
        subject: "Confirm your ARStacksOps account",
        url: "https://example.test/verify",
        text: "Confirm your account",
      }),
    ).rejects.toThrow(EMAIL_ACTION_CLOSED_MESSAGE);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("still requires SMTP in production when delivery is not explicitly off", () => {
    process.env.NODE_ENV = "production";
    process.env.EMAIL_DELIVERY = "";
    process.env.DATABASE_URL = "postgres://example";
    delete process.env.SMTP_PASSWORD;
    expect(productionStartupError()).toMatch(/SMTP_HOST/);
    delete process.env.DATABASE_URL;
    expect(productionStartupError()).toMatch(/DATABASE_URL/);
    process.env.NODE_ENV = "test";
    expect(productionStartupError()).toBeNull();
  });

  it("does not treat the test mailbox as delivery in production", () => {
    process.env.NODE_ENV = "production";
    process.env.EMAIL_DELIVERY = "test";
    delete process.env.SMTP_PASSWORD;
    expect(usingTestMailbox()).toBe(false);
    expect(canSendEmail()).toBe(false);
  });
});
