import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { UserPicker } from "./UserPicker";
import { VoiceNoteField, VoicePlayer } from "./VoiceNoteField";
import { formatWhen } from "../format";
import { unreadMentionIds } from "../mentions";
import { taskStore } from "../storage/localStore";
import type { Comment, User, VoiceNote } from "../types";

interface CommentsProps {
  taskId: string;
  users: User[];
  currentUserId: string;
  onChanged: () => Promise<void>;
}

export function Comments({ taskId, users, currentUserId, onChanged }: CommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [voice, setVoice] = useState<VoiceNote | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const changed = await taskStore.markMentionsRead(taskId, currentUserId);
        const next = await taskStore.listComments(taskId);
        if (cancelled) return;
        setComments(next);
        setLoaded(true);
        if (changed) await onChanged();
      } catch (caught) {
        if (!cancelled) {
          setLoaded(true);
          setError(caught instanceof Error ? caught.message : "Could not load comments");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, currentUserId, onChanged]);

  function toggleMention(user: User) {
    setMentionIds((current) => {
      if (current.includes(user.id)) return current.filter((id) => id !== user.id);
      setBody((text) =>
        text.includes(`@${user.name}`)
          ? text
          : `${text}${text.length > 0 && !text.endsWith(" ") ? " " : ""}@${user.name} `,
      );
      return [...current, user.id];
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const comment = await taskStore.addComment(taskId, {
        body,
        authorId: currentUserId,
        mentionIds,
        voice,
      });
      setComments((current) => [...current, comment]);
      setBody("");
      setMentionIds([]);
      setVoice(null);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the comment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="block discussion" aria-labelledby="comments-heading">
      <h2 id="comments-heading">Discussion</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Add a comment
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            placeholder="Type a comment, or record a voice note"
          />
        </label>
        <VoiceNoteField
          note={voice}
          onChange={(next) => {
            setVoice(next);
            setRecording(false);
          }}
          onRecordingChange={setRecording}
        />
        <UserPicker
          users={users}
          selectedIds={mentionIds}
          onToggle={toggleMention}
          label="Tag with @"
        />
        {error ? <p className="form-error">{error}</p> : null}
        <div className="form-actions">
          <button
            className="primary"
            type="submit"
            disabled={busy || recording || !currentUserId || (!body.trim() && !voice)}
          >
            {busy ? "Saving…" : "Add comment"}
          </button>
        </div>
      </form>
      {loaded && comments.length === 0 ? <p className="muted">No comments yet.</p> : null}
      <ol className="comment-list">
        {comments.map((comment) => {
          const unread = unreadMentionIds(comment);
          const author = users.find((user) => user.id === comment.authorId);
          const unreadNames = unread
            .map((id) => users.find((user) => user.id === id)?.name)
            .filter((name): name is string => Boolean(name));
          return (
            <li key={comment.id}>
              <time dateTime={comment.createdAt}>{formatWhen(comment.createdAt)}</time>
              {author ? <span className="comment-author">{author.name}</span> : null}
              {unreadNames.length > 0 ? (
                <span className="bang" title={`${unreadNames.join(", ")} has not read this`}>
                  !
                  <span className="bang-text"> {unreadNames.join(", ")} has not read this</span>
                </span>
              ) : null}
              {comment.body ? <p>{comment.body}</p> : null}
              {comment.voice ? <VoicePlayer voice={comment.voice} /> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
