import { useState } from "react";
import type { FormEvent } from "react";
import { authClient, authError } from "../auth/client";

type Mode = "sign-in" | "sign-up" | "forgot" | "reset" | "resend";

function unverified(message: string | null): boolean {
  return /email not verified/i.test(message ?? "");
}

interface AuthScreenProps {
  notice: string | null;
  resetToken: string | null;
  onSignedIn: () => Promise<void>;
}

export function AuthScreen({ notice, resetToken, onSignedIn }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(notice);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (mode !== "forgot" && mode !== "resend" && password.length < 8) {
      setError("Use at least 8 characters for the password.");
      return;
    }
    if ((mode === "sign-up" || mode === "reset") && password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setPending(true);
    try {
      if (mode === "sign-up") {
        const result = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          callbackURL: "/?verified=1",
        });
        const failed = authError(result);
        if (failed) {
          setError(failed);
          return;
        }
        setMode("sign-in");
        setPassword("");
        setConfirm("");
        setMessage("Account created. Confirm it before signing in. If the confirmation message does not arrive, resend it.");
        return;
      }
      if (mode === "resend") {
        const result = await authClient.sendVerificationEmail({
          email: email.trim().toLowerCase(),
          callbackURL: "/?verified=1",
        });
        const failed = authError(result);
        if (failed) {
          setError(failed);
          return;
        }
        setMessage("If that address still needs confirmation, a new link has been requested.");
        return;
      }
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email: email.trim().toLowerCase(),
          redirectTo: "/?reset=1",
        });
        const failed = authError(result);
        if (failed) {
          setError(failed);
          return;
        }
        setMessage("If that account can sign in, a reset link has been sent.");
        return;
      }
      if (mode === "reset") {
        if (!resetToken) {
          setError("This reset link is missing its token.");
          return;
        }
        const result = await authClient.resetPassword({ newPassword: password, token: resetToken });
        const failed = authError(result);
        if (failed) {
          setError(failed);
          return;
        }
        setMode("sign-in");
        setPassword("");
        setConfirm("");
        setMessage("Password updated. Sign in with the new password.");
        return;
      }
      const result = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });
      const failed = authError(result);
      if (failed) {
        setError(failed);
        return;
      }
      await onSignedIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  const title =
    mode === "sign-up"
      ? "Create account"
      : mode === "forgot"
        ? "Reset password"
        : mode === "reset"
          ? "Choose a new password"
          : mode === "resend"
            ? "Resend verification email"
            : "Sign in";

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <img src="/ar-mark.png" alt="" />
        <h1>ARStacksOps</h1>
        <p className="muted">{title}</p>
        {message ? <p className="auth-note">{message}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {mode === "sign-up" ? (
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
          </label>
        ) : null}
        {mode !== "reset" ? (
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>
        ) : null}
        {mode !== "forgot" && mode !== "resend" ? (
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            />
          </label>
        ) : null}
        {mode === "sign-up" || mode === "reset" ? (
          <label>
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
              autoComplete="new-password"
            />
          </label>
        ) : null}
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Please wait…" : title}
        </button>
        <div className="auth-links">
          {mode === "sign-in" ? (
            <>
              <button className="quiet" type="button" onClick={() => { setMode("sign-up"); setError(null); }}>
                Create account
              </button>
              <button className="quiet" type="button" onClick={() => { setMode("forgot"); setError(null); }}>
                Forgot password
              </button>
              {unverified(error) ? (
                <button className="quiet" type="button" onClick={() => { setMode("resend"); setError(null); }}>
                  Resend verification email
                </button>
              ) : null}
            </>
          ) : (
            <button className="quiet" type="button" onClick={() => { setMode("sign-in"); setError(null); }}>
              Back to sign in
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
