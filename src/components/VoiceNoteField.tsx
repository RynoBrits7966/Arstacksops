import { useEffect, useRef, useState } from "react";
import type { VoiceNote } from "../types";

const MAX_MS = 2 * 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;

interface VoiceNoteFieldProps {
  note: VoiceNote | null;
  onChange: (note: VoiceNote | null) => void;
  onRecordingChange: (recording: boolean) => void;
}

export function VoiceNoteField({ note, onChange, onRecordingChange }: VoiceNoteFieldProps) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state === "recording") {
        recorder.onstop = null;
        recorder.stop();
      }
      releaseStream();
    };
  }, []);

  function releaseStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record voice notes.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const started = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - started;
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        releaseStream();
        setRecording(false);
        onRecordingChange(false);
        recorderRef.current = null;
        if (blob.size === 0) {
          setError("The voice note was empty. Try again.");
          return;
        }
        if (blob.size > MAX_BYTES) {
          setError("Voice notes must be 8 MB or smaller.");
          return;
        }
        onChange({
          blob,
          mimeType: blob.type || "audio/webm",
          durationMs,
        });
      };
      recorderRef.current = recorder;
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - started;
        setSeconds(Math.floor(elapsed / 1000));
        if (elapsed >= MAX_MS && recorder.state === "recording") recorder.stop();
      }, 250);
      recorder.start();
      setRecording(true);
      onRecordingChange(true);
    } catch {
      releaseStream();
      setRecording(false);
      setError("Allow microphone access to record a voice note.");
    }
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  return (
    <div className="voice-field">
      <div className="form-actions">
        {recording ? (
          <button className="quiet recording" type="button" onClick={stop}>
            Stop · {formatClock(seconds)}
          </button>
        ) : (
          <button className="quiet" type="button" onClick={start}>
            {note ? "Record again" : "Record voice note"}
          </button>
        )}
        {note && !recording ? (
          <button className="quiet" type="button" onClick={() => onChange(null)}>
            Remove voice note
          </button>
        ) : null}
      </div>
      {recording ? <p className="muted">Recording… up to 2 minutes.</p> : null}
      {note && !recording ? (
        <p className="muted">Voice note ready · {formatClock(Math.round(note.durationMs / 1000))}</p>
      ) : null}
      {note ? <VoicePlayer voice={note} /> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

export function VoicePlayer({ voice }: { voice: VoiceNote }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const next = URL.createObjectURL(voice.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [voice]);

  if (!url) return null;
  return <audio className="voice-player" controls src={url} />;
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
