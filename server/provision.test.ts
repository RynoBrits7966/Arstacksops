import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemoryDB } from "better-auth/adapters/memory";
import { verifyPassword } from "better-auth/crypto";
import { createApp } from "./app";
import { EMAIL_ACTION_CLOSED_MESSAGE, SIGNUP_CLOSED_MESSAGE } from "./mail";
import { provisionStaff, safeProvisionError } from "./provision";

const origin = "http://localhost:5173";
const chosenPassword = "andrew-chosen-pass";
const staff = [
  { email: "andrew@arstacks.co.za", env: "PROVISION_PASSWORD_ANDREW", password: "andrew-temp-pass" },
  { email: "barend@arstacks.co.za", env: "PROVISION_PASSWORD_BAREND", password: "barend-temp-pass" },
  { email: "ryno@arstacks.co.za", env: "PROVISION_PASSWORD_RYNO", password: "ryno-temp-pass" },
] as const;

type TestApp = {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
};

async function post(app: TestApp, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  });
}

describe("staff provisioning", () => {
  const envKeys = [
    "SIGNUP_ALLOWLIST",
    "EMAIL_DELIVERY",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "NODE_ENV",
    "DATABASE_URL",
    ...staff.map((member) => member.env),
  ] as const;
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    process.env.SIGNUP_ALLOWLIST = "andrew@arstacks.co.za,barend@arstacks.co.za,ryno@arstacks.co.za,stranger@arstacks.co.za";
    process.env.EMAIL_DELIVERY = "test";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
    process.env.BETTER_AUTH_URL = origin;
    process.env.NODE_ENV = "test";
    delete process.env.DATABASE_URL;
    for (const member of staff) delete process.env[member.env];
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("signs in the three approved accounts and rejects registration while email is off", async () => {
    const memory: MemoryDB = {};
    const { app, auth } = await createApp({ memory });
    expect(auth.options.emailAndPassword?.requireEmailVerification).toBe(true);

    const signedUp = await post(app, "/api/auth/sign-up/email", {
      name: "Andrew",
      email: "andrew@arstacks.co.za",
      password: chosenPassword,
      callbackURL: "/?verified=1",
    });
    expect(signedUp.status).toBe(200);
    const before = await post(app, "/api/auth/sign-in/email", {
      email: "andrew@arstacks.co.za",
      password: chosenPassword,
    });
    expect(before.status).toBe(403);

    process.env.EMAIL_DELIVERY = "off";
    for (const member of staff) process.env[member.env] = member.password;

    const notes: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      notes.push(args.map(String).join(" "));
    };
    let results;
    try {
      results = await provisionStaff(auth);
    } finally {
      console.log = original;
    }
    expect(results).toEqual([
      { email: "andrew@arstacks.co.za", status: "verified-existing" },
      { email: "barend@arstacks.co.za", status: "created" },
      { email: "ryno@arstacks.co.za", status: "created" },
    ]);
    const dumped = JSON.stringify(results) + notes.join("\n");
    for (const member of staff) expect(dumped).not.toContain(member.password);
    expect(dumped).not.toContain(chosenPassword);

    const andrewKept = await post(app, "/api/auth/sign-in/email", {
      email: "andrew@arstacks.co.za",
      password: chosenPassword,
    });
    expect(andrewKept.status).toBe(200);
    expect(await andrewKept.json()).toMatchObject({
      user: { email: "andrew@arstacks.co.za", emailVerified: true },
    });
    const andrewReplaced = await post(app, "/api/auth/sign-in/email", {
      email: "andrew@arstacks.co.za",
      password: "andrew-temp-pass",
    });
    expect(andrewReplaced.status).toBe(401);

    for (const member of staff.slice(1)) {
      const signedIn = await post(app, "/api/auth/sign-in/email", {
        email: member.email,
        password: member.password,
      });
      expect(signedIn.status).toBe(200);
      expect(await signedIn.json()).toMatchObject({
        user: { email: member.email, emailVerified: true, name: member.email.startsWith("barend") ? "Barend" : "Ryno" },
      });
    }

    const accounts = memory.account as { password?: string; providerId?: string }[];
    const stored = accounts.map((row) => row.password ?? "");
    for (const member of staff) {
      expect(stored.some((hash) => hash === member.password)).toBe(false);
      expect(stored.some((hash) => hash.includes(member.password))).toBe(false);
    }
    const matched = await Promise.all(stored.map(async (hash) => (hash ? verifyPassword({ hash, password: "barend-temp-pass" }) : false)));
    expect(matched.some(Boolean)).toBe(true);

    const delivery = await app.request("/api/email-delivery");
    expect(await delivery.json()).toEqual({ available: false });

    for (const email of ["outsider@example.com", "stranger@arstacks.co.za"]) {
      const rejected = await post(app, "/api/auth/sign-up/email", {
        name: "Outsider",
        email,
        password: "not-allowed-pass",
      });
      expect(rejected.status).toBe(503);
      expect(await rejected.json()).toMatchObject({ message: SIGNUP_CLOSED_MESSAGE });
    }
    const resent = await post(app, "/api/auth/send-verification-email", {
      email: "andrew@arstacks.co.za",
      callbackURL: "/?verified=1",
    });
    expect(resent.status).toBe(503);
    expect(await resent.json()).toMatchObject({ message: EMAIL_ACTION_CLOSED_MESSAGE });
    const reset = await post(app, "/api/auth/request-password-reset", {
      email: "outsider@example.com",
      redirectTo: "/?reset=1",
    });
    expect(reset.status).toBe(503);
    expect(await reset.json()).toMatchObject({ message: EMAIL_ACTION_CLOSED_MESSAGE });

    for (const member of staff) process.env[member.env] = `${member.password}-again`;
    const second = await provisionStaff(auth);
    expect(second.every((result) => result.status === "unchanged")).toBe(true);
    const stillChosen = await post(app, "/api/auth/sign-in/email", {
      email: "andrew@arstacks.co.za",
      password: chosenPassword,
    });
    expect(stillChosen.status).toBe(200);
    const stillBarend = await post(app, "/api/auth/sign-in/email", {
      email: "barend@arstacks.co.za",
      password: "barend-temp-pass",
    });
    expect(stillBarend.status).toBe(200);
    const replacedBarend = await post(app, "/api/auth/sign-in/email", {
      email: "barend@arstacks.co.za",
      password: "barend-temp-pass-again",
    });
    expect(replacedBarend.status).toBe(401);
  });

  it("writes nothing when a new account is missing its password variable", async () => {
    process.env.EMAIL_DELIVERY = "off";
    process.env.PROVISION_PASSWORD_BAREND = "barend-temp-pass";
    process.env.PROVISION_PASSWORD_RYNO = "ryno-temp-pass";
    const { app, auth } = await createApp({ memory: {} });
    await expect(provisionStaff(auth)).rejects.toThrow("PROVISION_PASSWORD_ANDREW is not set");
    const signedIn = await post(app, "/api/auth/sign-in/email", {
      email: "barend@arstacks.co.za",
      password: "barend-temp-pass",
    });
    expect(signedIn.status).toBe(401);
  });

  it("refuses a short password without repeating it", async () => {
    process.env.EMAIL_DELIVERY = "off";
    process.env.PROVISION_PASSWORD_ANDREW = "short";
    process.env.PROVISION_PASSWORD_BAREND = "barend-temp-pass";
    process.env.PROVISION_PASSWORD_RYNO = "ryno-temp-pass";
    const { auth } = await createApp({ memory: {} });
    const error = await provisionStaff(auth).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("PROVISION_PASSWORD_ANDREW must be at least 8 characters");
    expect(safeProvisionError(error)).not.toContain("short");
  });

  it("stops before creating anyone when an approved address is off the allowlist", async () => {
    process.env.EMAIL_DELIVERY = "off";
    process.env.SIGNUP_ALLOWLIST = "andrew@arstacks.co.za";
    for (const member of staff) process.env[member.env] = member.password;
    const { app, auth } = await createApp({ memory: {} });
    await expect(provisionStaff(auth)).rejects.toThrow("barend@arstacks.co.za is not on SIGNUP_ALLOWLIST");
    const signedIn = await post(app, "/api/auth/sign-in/email", {
      email: "andrew@arstacks.co.za",
      password: "andrew-temp-pass",
    });
    expect(signedIn.status).toBe(401);
  });
});
