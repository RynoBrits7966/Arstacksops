import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemoryDB } from "better-auth/adapters/memory";
import { verifyPassword } from "better-auth/crypto";
import { emptySnapshot } from "../src/storage/snapshot";
import { createApp } from "./app";
import { clearMailbox, capturedMail } from "./mail";

const origin = "http://localhost:5173";

function cookieFrom(response: Response): string {
  const list = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const raw = list.length > 0 ? list : [response.headers.get("set-cookie") ?? ""];
  return raw
    .flatMap((value) => value.split(","))
    .map((value) => value.split(";")[0]?.trim() ?? "")
    .filter((value) => value.includes("="))
    .join("; ");
}

type TestApp = {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
};

async function post(app: TestApp, path: string, body: unknown, cookie = "") {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      cookie,
    },
    body: JSON.stringify(body),
  });
}

async function verifyLatest(app: TestApp) {
  const message = capturedMail().at(-1);
  expect(message?.url).toBeTruthy();
  const url = new URL(message!.url);
  const response = await app.request(`${url.pathname}${url.search}`);
  expect(response.status).toBeGreaterThanOrEqual(300);
  expect(response.status).toBeLessThan(400);
}

describe("shared workspace auth", () => {
  const envKeys = [
    "SIGNUP_ALLOWLIST",
    "EMAIL_DELIVERY",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "NODE_ENV",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
  ] as const;
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    process.env.SIGNUP_ALLOWLIST = "one@arstacks.test,two@arstacks.test";
    process.env.EMAIL_DELIVERY = "test";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
    process.env.BETTER_AUTH_URL = origin;
    process.env.NODE_ENV = "test";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;
    clearMailbox();
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearMailbox();
  });

  it("rejects people who are not on the allowlist and blocks sign-up when email is not configured", async () => {
    const { app } = await createApp({ memory: {} });
    const outsider = await post(app, "/api/auth/sign-up/email", {
      name: "Outsider",
      email: "outsider@example.com",
      password: "correct-horse",
    });
    expect(outsider.status).toBe(400);
    expect(await outsider.json()).toMatchObject({ message: "This email is not allowed to register." });

    process.env.EMAIL_DELIVERY = "";
    const blocked = await post(app, "/api/auth/sign-up/email", {
      name: "One",
      email: "one@arstacks.test",
      password: "correct-horse",
    });
    expect(blocked.status).toBe(503);
    const body = (await blocked.json()) as { message?: string };
    expect(body.message).toMatch(/not configured/i);
    expect(capturedMail()).toHaveLength(0);
  });

  it("stores a scrypt hash of the chosen password", async () => {
    const memory: MemoryDB = {};
    const { app } = await createApp({ memory });
    const signedUp = await post(app, "/api/auth/sign-up/email", {
      name: "One Member",
      email: "one@arstacks.test",
      password: "correct-horse",
      callbackURL: "/?verified=1",
    });
    expect(signedUp.status).toBe(200);
    const accounts = memory.account as { password?: string }[];
    const stored = accounts.find((row) => row.password)?.password ?? "";
    expect(stored).not.toBe("correct-horse");
    expect(stored.includes("correct-horse")).toBe(false);
    expect(await verifyPassword({ hash: stored, password: "correct-horse" })).toBe(true);
  });

  it("requires verification, then shares one empty board between the two members", async () => {
    const { app } = await createApp({ memory: {} });
    const locked = await app.request("/api/workspace");
    expect(locked.status).toBe(401);

    const signedUp = await post(app, "/api/auth/sign-up/email", {
      name: "One Member",
      email: "one@arstacks.test",
      password: "correct-horse",
      callbackURL: "/?verified=1",
    });
    expect(signedUp.status).toBe(200);

    const tooSoon = await post(app, "/api/auth/sign-in/email", {
      email: "one@arstacks.test",
      password: "correct-horse",
    });
    expect(tooSoon.status).toBeGreaterThanOrEqual(400);

    await verifyLatest(app);
    const signedIn = await post(app, "/api/auth/sign-in/email", {
      email: "one@arstacks.test",
      password: "correct-horse",
    });
    expect(signedIn.status).toBe(200);
    const oneCookie = cookieFrom(signedIn);
    expect(oneCookie).not.toBe("");

    const empty = await app.request("/api/workspace", { headers: { cookie: oneCookie } });
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as { version: number; snapshot: { projects: unknown[]; tasks: unknown[]; users: { name: string }[] } };
    expect(emptyBody.snapshot.projects).toEqual([]);
    expect(emptyBody.snapshot.tasks).toEqual([]);
    expect(emptyBody.snapshot.users.map((user) => user.name)).toEqual(["One Member"]);

    const snapshot = emptySnapshot();
    snapshot.projects.push({
      id: "project-live",
      name: "Live",
      color: "#3d7ea6",
      client: "Harbour",
      deadline: null,
      createdAt: "2026-10-12T00:00:00.000Z",
    });
    const saved = await app.request("/api/workspace", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: oneCookie },
      body: JSON.stringify({ version: emptyBody.version, snapshot }),
    });
    expect(saved.status).toBe(200);

    const second = await post(app, "/api/auth/sign-up/email", {
      name: "Two Member",
      email: "two@arstacks.test",
      password: "correct-horse",
      callbackURL: "/?verified=1",
    });
    expect(second.status).toBe(200);
    await verifyLatest(app);
    const secondSignIn = await post(app, "/api/auth/sign-in/email", {
      email: "two@arstacks.test",
      password: "correct-horse",
    });
    expect(secondSignIn.status).toBe(200);
    const shared = await app.request("/api/workspace", { headers: { cookie: cookieFrom(secondSignIn) } });
    expect(shared.status).toBe(200);
    const sharedBody = (await shared.json()) as { snapshot: { projects: { name: string }[]; users: { name: string }[] } };
    expect(sharedBody.snapshot.projects.map((project) => project.name)).toEqual(["Live"]);
    expect(sharedBody.snapshot.users.map((user) => user.name)).toEqual(["One Member", "Two Member"]);

    const signedOut = await post(app, "/api/auth/sign-out", {}, oneCookie);
    expect(signedOut.status).toBe(200);
    const after = await app.request("/api/workspace", { headers: { cookie: oneCookie } });
    expect(after.status).toBe(401);
  });

  it("sends a reset link and accepts the new password", async () => {
    const { app } = await createApp({ memory: {} });
    const signedUp = await post(app, "/api/auth/sign-up/email", {
      name: "One Member",
      email: "one@arstacks.test",
      password: "correct-horse",
      callbackURL: "/?verified=1",
    });
    expect(signedUp.status).toBe(200);
    await verifyLatest(app);
    clearMailbox();

    const requested = await post(app, "/api/auth/request-password-reset", {
      email: "one@arstacks.test",
      redirectTo: "/?reset=1",
    });
    expect(requested.status).toBe(200);
    const link = capturedMail().at(-1)?.url ?? "";
    const resetUrl = new URL(link);
    const redirected = await app.request(`${resetUrl.pathname}${resetUrl.search}`);
    expect(redirected.status).toBeGreaterThanOrEqual(300);
    const location = redirected.headers.get("location") ?? "";
    const token = new URL(location, origin).searchParams.get("token");
    expect(token).toBeTruthy();

    const reset = await post(app, "/api/auth/reset-password", { newPassword: "new-password", token });
    expect(reset.status).toBe(200);
    const signedIn = await post(app, "/api/auth/sign-in/email", {
      email: "one@arstacks.test",
      password: "new-password",
    });
    expect(signedIn.status).toBe(200);
  });
});
