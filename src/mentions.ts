export function unreadMentionIds(comment: {
  mentionIds?: string[];
  readByIds?: string[];
}): string[] {
  const read = new Set(comment.readByIds ?? []);
  return (comment.mentionIds ?? []).filter((id) => !read.has(id));
}
