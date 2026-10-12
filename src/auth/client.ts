import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? "http://localhost:5173" : window.location.origin,
});

export interface SignedInUser {
  id: string;
  name: string;
  email: string;
}

export async function currentSession(): Promise<SignedInUser | null> {
  const response = await fetch("/api/auth/get-session", { credentials: "include" });
  if (!response.ok) return null;
  const body = (await response.json()) as { user?: { id?: string; name?: string; email?: string; emailVerified?: boolean } } | null;
  const user = body?.user;
  if (!user?.id || !user.email || !user.emailVerified) return null;
  return { id: user.id, name: user.name || user.email, email: user.email };
}

export function authError(result: { error?: { message?: string } | null }): string | null {
  return result.error?.message ?? null;
}
