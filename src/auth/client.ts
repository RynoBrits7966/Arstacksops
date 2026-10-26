import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? "http://localhost:5173" : window.location.origin,
});

export interface SignedInUser {
  id: string;
  name: string;
  email: string;
}

const SESSION_KEY = "arstacksops.session";

function rememberSession(user: SignedInUser) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

export function forgetSession() {
  localStorage.removeItem(SESSION_KEY);
}

function storedSession(): SignedInUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SignedInUser>;
    if (!parsed.id || !parsed.email) return null;
    return { id: parsed.id, name: parsed.name || parsed.email, email: parsed.email };
  } catch {
    return null;
  }
}

export async function currentSession(): Promise<SignedInUser | null> {
  try {
    const response = await fetch("/api/auth/get-session", { credentials: "include" });
    if (!response.ok) {
      forgetSession();
      return null;
    }
    const body = (await response.json()) as { user?: { id?: string; name?: string; email?: string; emailVerified?: boolean } } | null;
    const user = body?.user;
    if (!user?.id || !user.email || !user.emailVerified) {
      forgetSession();
      return null;
    }
    const signedIn = { id: user.id, name: user.name || user.email, email: user.email };
    rememberSession(signedIn);
    return signedIn;
  } catch {
    return storedSession();
  }
}

export function authError(result: { error?: { message?: string } | null }): string | null {
  return result.error?.message ?? null;
}
