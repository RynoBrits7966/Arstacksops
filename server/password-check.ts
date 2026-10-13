import type { Auth } from "./auth";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

const failures = new Map<string, { count: number; resetAt: number }>();

interface CredentialAccount {
  providerId?: string;
  password?: string | null;
}

export function clearPasswordAttempts(): void {
  failures.clear();
}

export function passwordAttemptLimited(userId: string, now = Date.now()): boolean {
  const entry = failures.get(userId);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= MAX_FAILURES;
}

export function recordPasswordFailure(userId: string, now = Date.now()): void {
  const entry = failures.get(userId);
  if (!entry || entry.resetAt <= now) {
    failures.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearPasswordFailure(userId: string): void {
  failures.delete(userId);
}

/** Checks the signed-in member's credential hash. Does not create a session or log the password. */
export async function passwordMatches(auth: Auth, email: string, password: string): Promise<boolean> {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email, { includeAccounts: true });
  const accounts = (found?.accounts ?? []) as CredentialAccount[];
  const account = accounts.find(
    (item) => item.providerId === "credential" && typeof item.password === "string" && item.password.length > 0,
  );
  if (!account?.password) return false;
  return ctx.password.verify({ hash: account.password, password });
}
