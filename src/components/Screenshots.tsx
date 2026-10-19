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
  reloadKey?: number;
}

export function Screenshots({ taskId, reloadKey = 0 }: ScreenshotsProps) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<Shot | null>(null);
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
      setPreview(null);
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    };
  }, [taskId, reloadKey]);

  useEffect(() => {
    if (!preview) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPreview(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [preview]);

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
          <span>{busy ? "Uploading…" : "Upload screenshot"}</span>
          <input
            type="file"
            aria-label="Upload screenshot"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/heic,image/heif,.png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.heif"
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
            <button
              className="shot-open"
              type="button"
              onClick={() => setPreview(shot)}
              aria-label={`Open ${shot.fileName}`}
            >
              {broken[shot.id] ? (
                <span className="form-error">Could not load {shot.fileName}.</span>
              ) : (
                <img
                  src={shot.url}
                  alt={shot.fileName}
                  onError={() => setBroken((current) => ({ ...current, [shot.id]: true }))}
                />
              )}
            </button>
            <span>
              {shot.fileName}
              <time dateTime={shot.createdAt}>{formatWhen(shot.createdAt)}</time>
            </span>
          </li>
        ))}
      </ul>
      {preview ? (
        <div className="shot-preview-layer" role="presentation" onMouseDown={() => setPreview(null)}>
          <div
            className="shot-preview"
            role="dialog"
            aria-modal="true"
            aria-label={preview.fileName}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="shot-preview-bar">
              <p>{preview.fileName}</p>
              <button className="ghost" type="button" onClick={() => setPreview(null)} autoFocus>
                Close
              </button>
            </div>
            {broken[preview.id] ? (
              <p className="form-error">Could not open {preview.fileName}.</p>
            ) : (
              <img
                src={preview.url}
                alt={preview.fileName}
                onError={() => setBroken((current) => ({ ...current, [preview.id]: true }))}
              />
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
