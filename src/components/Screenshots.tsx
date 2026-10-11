import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { formatWhen } from "../format";
import { taskStore } from "../storage/localStore";
import type { Attachment } from "../types";

interface Shot extends Attachment {
  url: string;
}

interface ScreenshotsProps {
  taskId: string;
}

export function Screenshots({ taskId }: ScreenshotsProps) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    taskStore
      .listAttachments(taskId)
      .then((items) => {
        if (cancelled) return;
        setShots(
          items.map((item) => {
            const url = URL.createObjectURL(item.blob);
            urlsRef.current.push(url);
            return { ...item, url };
          }),
        );
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load screenshots");
        }
      });
    return () => {
      cancelled = true;
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    };
  }, [taskId]);

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const saved = await taskStore.addAttachment(taskId, file);
      const url = URL.createObjectURL(saved.blob);
      urlsRef.current.push(url);
      setShots((current) => [...current, { ...saved, url }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload the screenshot");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="block" aria-labelledby="screenshots-heading">
      <div className="panel-heading">
        <h2 id="screenshots-heading">Screenshots</h2>
        <label className="upload-button">
          {busy ? "Uploading…" : "Upload screenshot"}
          <input
            type="file"
            accept="image/*"
            onChange={handleChange}
            disabled={busy}
          />
        </label>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {shots.length === 0 ? <p className="muted">No screenshots yet.</p> : null}
      <ul className="shot-list">
        {shots.map((shot) => (
          <li key={shot.id}>
            <img src={shot.url} alt={shot.fileName} />
            <span>
              {shot.fileName}
              <time dateTime={shot.createdAt}>{formatWhen(shot.createdAt)}</time>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
