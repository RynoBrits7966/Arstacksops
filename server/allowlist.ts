/** Comma-separated emails from the server environment. Never send this list to the browser. */
export function signupAllowlist(): Set<string> {
  return new Set(
    (process.env.SIGNUP_ALLOWLIST ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

export function isAllowlisted(email: string): boolean {
  return signupAllowlist().has(email.trim().toLowerCase());
}
