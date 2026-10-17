import { useCallback, useEffect, useState } from "react";
import { authClient, currentSession, type SignedInUser } from "./auth/client";
import { AuthScreen } from "./components/AuthScreen";
import { BacklogView } from "./components/BacklogView";
import { IssueBoard } from "./components/IssueBoard";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { StatsPage } from "./components/StatsPage";
import { unreadMentionIds } from "./mentions";
import { compareDeadlinePriority, isSignedOff } from "./projects";
import { AuthRequiredError, closeWorkspace, taskStore } from "./storage/localStore";
import type { Comment, Project, Task, TaskStatus, User } from "./types";

const VIEW_KEY = "arstacksops.view";
const MENU_KEY = "arstacksops.menu";
const BOARD_REFRESH_MS = 60 * 60 * 1000;

type WorkspaceView = "work" | "backlog" | "stats";

function storedView(): WorkspaceView {
  const stored = localStorage.getItem(VIEW_KEY);
  if (stored === "backlog" || stored === "stats") return stored;
  return "work";
}

function storedMenuCollapsed(): boolean {
  return localStorage.getItem(MENU_KEY) === "collapsed";
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [session, setSession] = useState<SignedInUser | null | undefined>(undefined);
  const [tab, setTab] = useState<TaskStatus>("new");
  const [projectFilter, setProjectFilter] = useState<string | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backlogSelectedId, setBacklogSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>(storedView);
  const [menuCollapsed, setMenuCollapsed] = useState(storedMenuCollapsed);
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    currentSession()
      .then((user) => {
        if (!cancelled) setSession(user);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    refresh()
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof AuthRequiredError) {
          closeWorkspace();
          setSession(null);
          return;
        }
        setError(caught instanceof Error ? caught.message : "Could not open the shared board");
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, session]);

  useEffect(() => {
    if (!session) return;
    let lastRefresh = Date.now();
    let running = false;
    async function pull() {
      if (running) return;
      running = true;
      try {
        await refresh();
        lastRefresh = Date.now();
      } catch (caught: unknown) {
        if (caught instanceof AuthRequiredError) {
          closeWorkspace();
          setSession(null);
        }
      } finally {
        running = false;
      }
    }
    const timer = window.setInterval(() => {
      void pull();
    }, BOARD_REFRESH_MS);
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefresh < BOARD_REFRESH_MS) return;
      void pull();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, session]);

  const selectedProject = projects.find((project) => project.id === projectFilter) ?? null;
  const boardProjects = selectedProject ? [selectedProject] : projects.filter((project) => !isSignedOff(project));
  const boardProjectIds = new Set(boardProjects.map((project) => project.id));
  const boardTasks = tasks.filter((task) => boardProjectIds.has(task.projectId));
  const orderedTasks = [...boardTasks].sort((a, b) => {
    const deadlineOf = (task: Task) => projects.find((project) => project.id === task.projectId)?.deadline ?? null;
    const byDeadline = compareDeadlinePriority(deadlineOf(a), deadlineOf(b));
    if (byDeadline !== 0) return byDeadline;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const unreadTaskIds = new Set(
    comments.filter((comment) => unreadMentionIds(comment).length > 0).map((comment) => comment.taskId),
  );

  async function signOut() {
    await authClient.signOut();
    closeWorkspace();
    setReady(false);
    setTasks([]);
    setProjects([]);
    setUsers([]);
    setComments([]);
    setSelectedId(null);
    setBacklogSelectedId(null);
    setSession(null);
  }

  function chooseView(next: WorkspaceView) {
    localStorage.setItem(VIEW_KEY, next);
    setView(next);
  }

  function chooseMenu(collapsed: boolean) {
    localStorage.setItem(MENU_KEY, collapsed ? "collapsed" : "open");
    setMenuCollapsed(collapsed);
  }

  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get("token");
  const notice = params.get("verified") === "1" ? "Email confirmed. Sign in to open the board." : null;
  if (session === undefined) {
    return <p className="empty auth-wait">Loading…</p>;
  }
  if (!session) {
    return (
      <AuthScreen
        notice={notice}
        resetToken={params.get("reset") === "1" ? resetToken : null}
        onSignedIn={async () => {
          const user = await currentSession();
          setReady(false);
          setError(null);
          setSession(user);
        }}
      />
    );
  }

  return (
    <div className={menuCollapsed ? "app menu-collapsed" : "app"}>
      <ProjectSidebar
        projects={projects}
        tasks={tasks}
        sessionName={session.name}
        onSignOut={() => void signOut()}
        onCollapse={() => chooseMenu(true)}
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
          <div className="board-bar-start">
            {menuCollapsed ? (
              <button className="menu-toggle" type="button" onClick={() => chooseMenu(false)}>
                Menu
              </button>
            ) : null}
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
        </div>
        {error ? <p className="form-error banner">{error}</p> : null}
        {!ready ? <p className="empty">Loading issues…</p> : null}
        {ready && !error && view === "work" ? (
          <IssueBoard
            tasks={orderedTasks}
            projects={boardProjects}
            users={users}
            comments={comments}
            currentUserId={session.id}
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
            tasks={boardTasks}
            projects={boardProjects}
            users={users}
            currentUserId={session.id}
            projectFilter={projectFilter}
            selectedId={backlogSelectedId}
            onSelect={setBacklogSelectedId}
            onChanged={refresh}
          />
        ) : null}
        {ready && !error && view === "stats" ? (
          <StatsPage tasks={boardTasks} projects={boardProjects} projectFilter={projectFilter} />
        ) : null}
      </div>
    </div>
  );
}
