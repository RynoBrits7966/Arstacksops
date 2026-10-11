import { useCallback, useEffect, useState } from "react";
import { BacklogView } from "./components/BacklogView";
import { IssueBoard } from "./components/IssueBoard";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { StatsPage } from "./components/StatsPage";
import { unreadMentionIds } from "./mentions";
import { compareDeadlinePriority } from "./projects";
import { taskStore } from "./storage/localStore";
import type { Comment, Project, Task, TaskStatus, User } from "./types";

const CURRENT_USER_KEY = "arstacksops.currentUserId";
const VIEW_KEY = "arstacksops.view";

type WorkspaceView = "work" | "backlog" | "stats";

function storedView(): WorkspaceView {
  const stored = localStorage.getItem(VIEW_KEY);
  if (stored === "backlog" || stored === "stats") return stored;
  return "work";
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [tab, setTab] = useState<TaskStatus>("new");
  const [projectFilter, setProjectFilter] = useState<string | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backlogSelectedId, setBacklogSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>(storedView);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await taskStore.seedDemo();
    await taskStore.archiveExpired();
    const [nextTasks, nextProjects, nextUsers, nextComments] = await Promise.all([
      taskStore.listTasks(),
      taskStore.listProjects(),
      taskStore.listUsers(),
      taskStore.listAllComments(),
    ]);
    setTasks(nextTasks);
    setProjects(nextProjects);
    setUsers(nextUsers);
    setComments(nextComments);
    setCurrentUserId((current) => {
      const stored = current || localStorage.getItem(CURRENT_USER_KEY) || "user-jordan";
      const id = nextUsers.some((user) => user.id === stored) ? stored : (nextUsers[0]?.id ?? "");
      if (id) localStorage.setItem(CURRENT_USER_KEY, id);
      return id;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh()
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not open browser storage");
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const orderedTasks = [...tasks].sort((a, b) => {
    const deadlineOf = (task: Task) => projects.find((project) => project.id === task.projectId)?.deadline ?? null;
    const byDeadline = compareDeadlinePriority(deadlineOf(a), deadlineOf(b));
    if (byDeadline !== 0) return byDeadline;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const unreadTaskIds = new Set(
    comments.filter((comment) => unreadMentionIds(comment).length > 0).map((comment) => comment.taskId),
  );

  function chooseUser(userId: string) {
    localStorage.setItem(CURRENT_USER_KEY, userId);
    setCurrentUserId(userId);
  }

  function chooseView(next: WorkspaceView) {
    localStorage.setItem(VIEW_KEY, next);
    setView(next);
  }

  return (
    <div className="app">
      <ProjectSidebar
        projects={projects}
        tasks={tasks}
        users={users}
        currentUserId={currentUserId}
        onUserChange={chooseUser}
        selectedId={projectFilter}
        onSelect={(id) => {
          setProjectFilter(id);
          setSelectedId(null);
          setBacklogSelectedId(null);
        }}
        onChanged={refresh}
      />
      <div className={view === "backlog" ? "workspace backlog-mode" : "workspace"}>
        <div className="board-bar">
          <div className="view-switch" role="tablist" aria-label="Workspace view">
            <button
              className={view === "work" ? "tab active" : "tab"}
              type="button"
              role="tab"
              aria-selected={view === "work"}
              onClick={() => chooseView("work")}
            >
              Issues
            </button>
            <button
              className={view === "backlog" ? "tab active" : "tab"}
              type="button"
              role="tab"
              aria-selected={view === "backlog"}
              onClick={() => chooseView("backlog")}
            >
              Backlog
            </button>
            <button
              className={view === "stats" ? "tab active" : "tab"}
              type="button"
              role="tab"
              aria-selected={view === "stats"}
              onClick={() => chooseView("stats")}
            >
              Statistics
            </button>
          </div>
        </div>
        {error ? <p className="form-error banner">{error}</p> : null}
        {!ready ? <p className="empty">Loading issues…</p> : null}
        {ready && !error && view === "work" ? (
          <IssueBoard
            tasks={orderedTasks}
            projects={projects}
            users={users}
            comments={comments}
            currentUserId={currentUserId}
            projectFilter={projectFilter}
            tab={tab}
            selectedId={selectedId}
            unreadTaskIds={unreadTaskIds}
            onTab={setTab}
            onSelect={setSelectedId}
            onChanged={refresh}
          />
        ) : null}
        {ready && !error && view === "backlog" ? (
          <BacklogView
            tasks={tasks}
            projects={projects}
            users={users}
            currentUserId={currentUserId}
            projectFilter={projectFilter}
            selectedId={backlogSelectedId}
            onSelect={setBacklogSelectedId}
            onChanged={refresh}
          />
        ) : null}
        {ready && !error && view === "stats" ? (
          <StatsPage tasks={tasks} projects={projects} projectFilter={projectFilter} />
        ) : null}
      </div>
    </div>
  );
}
