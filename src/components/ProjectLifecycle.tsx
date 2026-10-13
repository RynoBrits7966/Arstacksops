import { useState } from "react";
import type { FormEvent } from "react";
import { taskStore } from "../storage/localStore";
import type { Project } from "../types";

interface ProjectLifecycleProps {
  project: Project;
  onChanged: () => Promise<void>;
  onDeleted: (name: string) => void;
  onSignedOff: (name: string) => void;
  onReopened: (name: string) => void;
}

type Step = "idle" | "sign-off" | "reopen" | "delete";

export function ProjectLifecycle({ project, onChanged, onDeleted, onSignedOff, onReopened }: ProjectLifecycleProps) {
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedOff = project.signOff ?? null;

  function cancel() {
    setStep("idle");
    setPassword("");
    setError(null);
  }

  async function run(action: () => Promise<void>): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      await action();
      setStep("idle");
      setPassword("");
      await onChanged();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the project.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmSignOff(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await taskStore.signOffProject(project.id);
      onSignedOff(project.name);
    });
  }

  async function confirmReopen(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await taskStore.reopenProject(project.id);
      onReopened(project.name);
    });
  }

  async function confirmDelete(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Enter your password to delete this project.");
      return;
    }
    const deleted = await run(async () => {
      await taskStore.deleteProject(project.id, password);
    });
    if (deleted) onDeleted(project.name);
  }

  return (
    <div className="project-lifecycle">
      {signedOff ? (
        <p className="project-meta">Signed off by {signedOff.name} on {formatWhen(signedOff.at)}.</p>
      ) : (
        <p className="project-meta">Active project</p>
      )}
      {step === "idle" ? (
        <div className="project-actions">
          {signedOff ? (
            <button className="quiet" type="button" onClick={() => { setError(null); setStep("reopen"); }}>
              Reopen
            </button>
          ) : (
            <button className="quiet" type="button" onClick={() => { setError(null); setStep("sign-off"); }}>
              Sign off
            </button>
          )}
          <button className="danger" type="button" onClick={() => { setError(null); setStep("delete"); }}>
            Delete project
          </button>
        </div>
      ) : null}
      {step === "sign-off" ? (
        <form className="side-form confirm-form" onSubmit={(event) => void confirmSignOff(event)}>
          <p>
            Sign off <strong>{project.name}</strong>? It leaves the active list and moves to Completed. Its issues,
            comments, and screenshots stay available there.
          </p>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="project-actions">
            <button className="quiet" type="button" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Signing off…" : "Sign off"}
            </button>
          </div>
        </form>
      ) : null}
      {step === "reopen" ? (
        <form className="side-form confirm-form" onSubmit={(event) => void confirmReopen(event)}>
          <p>
            Reopen <strong>{project.name}</strong>? It returns to the active list with its existing issues.
          </p>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="project-actions">
            <button className="quiet" type="button" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Reopening…" : "Reopen"}
            </button>
          </div>
        </form>
      ) : null}
      {step === "delete" ? (
        <form className="side-form confirm-form" onSubmit={(event) => void confirmDelete(event)}>
          <p>
            Delete <strong>{project.name}</strong>? This removes the project and its issues, comments, and screenshots.
            Other projects, people, and the rest of the board stay.
          </p>
          <label>
            Your password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="project-actions">
            <button className="quiet" type="button" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button className="danger" type="submit" disabled={busy}>
              {busy ? "Deleting…" : "Delete project"}
            </button>
          </div>
        </form>
      ) : null}
      {step === "idle" && error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
