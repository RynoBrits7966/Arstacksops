import type { WorkItemType } from "../types";

const COLOR: Record<WorkItemType, string> = {
  epic: "#eb8536",
  feature: "#b07cff",
  user_story: "#3ec6c0",
  task: "#f0c14a",
  bug: "#ff5a5a",
};

export function WorkTypeIcon({ type }: { type: WorkItemType }) {
  const color = COLOR[type];
  return (
    <svg className={`type-icon type-${type}`} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {type === "epic" ? (
        <path
          fill={color}
          d="M8 1.2 9.4 4.6 13 5l-2.7 2.4.8 3.5L8 9.2 4.9 10.9l.8-3.5L3 5l3.6-.4L8 1.2Z"
        />
      ) : null}
      {type === "feature" ? (
        <path
          fill={color}
          d="M8 1.5 9.2 5H13l-3 2.3 1.1 3.6L8 8.8 4.9 10.9 6 7.3 3 5h3.8L8 1.5Zm0 6.2 1.5 1-.5-1.7 1.4-1.1h-1.8L8 4.2 7.4 5.9H5.6l1.4 1.1-.5 1.7L8 7.7Z"
        />
      ) : null}
      {type === "user_story" ? (
        <path fill={color} d="M3 2.2h7.2L13 5v8.8H3V2.2Zm7 1.2v2.2H12L10 3.4ZM4.4 7.2h7.2v1.1H4.4V7.2Zm0 2.2h7.2v1.1H4.4V9.4Zm0 2.2h4.6v1.1H4.4v-1.1Z" />
      ) : null}
      {type === "task" ? (
        <path
          fill={color}
          d="M3 2.4h10v11.2H3V2.4Zm1.2 1.2v8.8h7.6V3.6H4.2Zm1.1 1.6 1.2 1.2 2.3-2.4.9.8-3.2 3.3-2.1-2.1.9-.8Zm0 3.2h5.4v1.1H5.3V8.4Zm0 2h5.4v1.1H5.3v-1.1Z"
        />
      ) : null}
      {type === "bug" ? (
        <path
          fill={color}
          d="M6.2 2.2h3.6l.5 1.2h1.5l-.7 1.1a4 4 0 0 1 1.7 2.2H14v1.3h-1.1a4.2 4.2 0 0 1-.4 1.4l1 1-.9.9-1.1-1.1a4 4 0 0 1-2.2.8h-.3v1.8H7.8v-1.8h-.3a4 4 0 0 1-2.2-.8l-1.1 1.1-.9-.9 1-1a4.2 4.2 0 0 1-.4-1.4H2V6.7h1.2A4 4 0 0 1 4 4.5L3.2 3.4h1.5l.5-1.2h1Zm1.8 2.2a2.6 2.6 0 0 0-2.6 2.4v.7h5.2v-.7A2.6 2.6 0 0 0 8 4.4Z"
        />
      ) : null}
    </svg>
  );
}
