import { Hono } from "hono";
import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";
import type { MemoryDB } from "better-auth/adapters/memory";
import { createAuth, type Auth } from "./auth";
import { canSendEmail, capturedMail, smtpSettings } from "./mail";
import { memoryWorkspace, postgresWorkspace, type Member, type WorkspaceStore } from "./workspace";
import type { User } from "../src/types";

export interface AppOptions {
  memory?: MemoryDB;
  pool?: Pool;
}

export async function createApp(options: AppOptions = {}) {
  const memory = options.memory ? seedMemory(options.memory) : options.pool ? null : seedMemory({});
  const pool = options.pool;
  if (process.env.NODE_ENV === "production" && !pool && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production");
  }
  const database = pool ? { pool } : { memory: memory ?? {} };
  const auth = createAuth(database);
  if (pool) {
    const plan = await getMigrations(auth.options);
    await plan.runMigrations();
  }
  const workspace: WorkspaceStore = pool ? postgresWorkspace(pool) : memoryWorkspace(database.memory ?? {});
  const app = new Hono();

  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.get("/api/workspace", async (c) => {
    const session = await requireSession(auth, c.req.raw.headers);
    if (!session) return c.json({ message: "Sign in required" }, 401);
    const record = await workspace.read();
    return c.json(record);
  });

  app.put("/api/workspace", async (c) => {
    const session = await requireSession(auth, c.req.raw.headers);
    if (!session) return c.json({ message: "Sign in required" }, 401);
    const body = await c.req.json().catch(() => null) as { version?: unknown; snapshot?: unknown } | null;
    if (!body || typeof body.version !== "number" || !body.snapshot) {
      return c.json({ message: "Send the board version and snapshot." }, 400);
    }
    const members = (await workspace.members()).filter((member) => member.emailVerified);
    try {
      const saved = await workspace.write(body.version, body.snapshot, toUsers(members));
      if (saved === "conflict") {
        return c.json({ message: "Someone else updated the board. Reload the page and try again." }, 409);
      }
      return c.json(saved);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the board.";
      return c.json({ message }, 400);
    }
  });

  if (process.env.NODE_ENV !== "production" && process.env.EMAIL_DELIVERY === "test") {
    app.get("/api/dev/mailbox", (c) => c.json({ messages: capturedMail() }));
  }

  return { app, auth, workspace, canSendEmail: canSendEmail() };
}

function seedMemory(db: MemoryDB): MemoryDB {
  for (const table of ["user", "session", "account", "verification"]) {
    if (!db[table]) db[table] = [];
  }
  return db;
}

function toUsers(members: Member[]): User[] {
  return members.map((member) => ({ id: member.id, name: member.name }));
}

async function requireSession(auth: Auth, headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.emailVerified) return null;
  return session;
}

export async function createListeningApp() {
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required in production");
  }
  if (process.env.NODE_ENV === "production" && !smtpSettings()) {
    throw new Error("SMTP_HOST, SMTP_PORT=465, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM are required in production");
  }
  if (!process.env.DATABASE_URL) {
    return createApp({ memory: {} });
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return createApp({ pool });
}
