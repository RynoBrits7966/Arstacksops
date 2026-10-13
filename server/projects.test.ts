import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptySnapshot } from "../src/storage/snapshot";
import type { Project } from "../src/types";
import { createApp } from "./app";
import { clearMailbox, capturedMail } from "./mail";
import { clearPasswordAttempts } from "./password-check";

const origin = "http://localhost:5173";
const password = "correct-horse";

type TestApp = {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
};

function cookieFrom(response: Response): string {
  const list = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const raw = list.length > 0 ? list : [response.headers.get("set-cookie") ?? ""];
  return raw
    .flatMap((value) => value.split(","))
    .map((value) => value.split(";")[0]?.trim() ?? "")
    .filter((value) => value.includes("="))
    .join("; ");
}

async function post(app: TestApp, path: string, body: unknown, cookie = "") {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      cookie,
    },
    body: JSON.stringify(body),
  });
}

async function verifyLatest(app: TestApp) {
  const message = capturedMail().at(-1);
  expect(message?.url).toBeTruthy();
  const url = new URL(message!.url);
  const response = await app.request(`${url.pathname}${url.search}`);
  expect(response.status).toBeGreaterThanOrEqual(300);
  expect(response.status).toBeLessThan(400);
}

interface Board {
  version: number;
  snapshot: {
    users: { name: string }[];
    projects: Project[];
    tasks: { id: string; projectId: string; title?: string }[];
    comments: { id: string; taskId: string }[];
    attachments: { id: string; taskId: string }[];
  };
}

describe("project deletion and sign-off", () => {
  const envKeys = ["SIGNUP_ALLOWLIST", "EMAIL_DELIVERY", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "NODE_ENV"] as const;
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    process.env.SIGNUP_ALLOWLIST = "one@arstacks.test";
    process.env.EMAIL_DELIVERY = "test";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret";
    process.env.BETTER_AUTH_URL = origin;
    process.env.NODE_ENV = "test";
    clearMailbox();
    clearPasswordAttempts();
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearMailbox();
    clearPasswordAttempts();
  });

  it("rejects a wrong password, deletes one project, then signs off and reopens the other", async () => {
    const { app } = await createApp({ memory: {} });
    const signedUp = await post(app, "/api/auth/sign-up/email", {
      name: "One Member",
      email: "one@arstacks.test",
      password,
      callbackURL: "/?verified=1",
    });
    expect(signedUp.status).toBe(200);
    await verifyLatest(app);
    const signedIn = await post(app, "/api/auth/sign-in/email", {
      email: "one@arstacks.test",
      password,
    });
    expect(signedIn.status).toBe(200);
    const cookie = cookieFrom(signedIn);

    const snapshot = emptySnapshot();
    snapshot.projects.push(
      {
        id: "project-test",
        name: "Test project",
        color: "#eb8536",
        client: "Trial",
        deadline: null,
        createdAt: "2026-10-13T00:00:00.000Z",
      },
      {
        id: "project-keep",
        name: "Keep",
        color: "#3d7ea6",
        client: "Harbour",
        deadline: null,
        createdAt: "2026-10-13T00:00:00.000Z",
      },
    );
    snapshot.tasks.push(
      {
        id: "task-test",
        projectId: "project-test",
        assigneeId: "",
        title: "Throwaway",
        description: "",
        status: "new",
        createdAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
        lastWorkedAt: "2026-10-13T00:00:00.000Z",
        closedAt: null,
        ticketNumber: 1,
        workItemType: "task",
        parentId: null,
        order: 0,
      } as (typeof snapshot.tasks)[number],
      {
        id: "task-keep",
        projectId: "project-keep",
        assigneeId: "",
        title: "Stay",
        description: "",
        status: "new",
        createdAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
        lastWorkedAt: "2026-10-13T00:00:00.000Z",
        closedAt: null,
        ticketNumber: 1,
        workItemType: "task",
        parentId: null,
        order: 0,
      } as (typeof snapshot.tasks)[number],
    );
    snapshot.comments.push(
      {
        id: "comment-test",
        taskId: "task-test",
        authorId: "member",
        body: "Temporary note",
        mentionIds: [],
        readByIds: [],
        voice: null,
        createdAt: "2026-10-13T00:00:00.000Z",
      },
      {
        id: "comment-keep",
        taskId: "task-keep",
        authorId: "member",
        body: "Keep this note",
        mentionIds: [],
        readByIds: [],
        voice: null,
        createdAt: "2026-10-13T00:00:00.000Z",
      },
    );
    snapshot.attachments.push({
      id: "file-test",
      taskId: "task-test",
      fileName: "shot.png",
      mimeType: "image/png",
      createdAt: "2026-10-13T00:00:00.000Z",
      dataBase64: "YQ==",
    });

    const opened = await app.request("/api/workspace", { headers: { cookie } });
    const openedBody = (await opened.json()) as Board;
    const saved = await app.request("/api/workspace", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ version: openedBody.version, snapshot }),
    });
    expect(saved.status).toBe(200);
    const seeded = (await saved.json()) as Board;

    const rejected = await post(app, "/api/projects/project-test/delete", { password: "wrong-password", version: seeded.version }, cookie);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ message: "That password is incorrect." });

    const stillThere = (await (await app.request("/api/workspace", { headers: { cookie } })).json()) as Board;
    expect(stillThere.version).toBe(seeded.version);
    expect(stillThere.snapshot.projects.map((project) => project.name)).toEqual(["Test project", "Keep"]);
    expect(stillThere.snapshot.tasks.map((task) => task.id)).toEqual(["task-test", "task-keep"]);
    expect(stillThere.snapshot.comments.map((comment) => comment.id)).toEqual(["comment-test", "comment-keep"]);
    expect(stillThere.snapshot.attachments.map((attachment) => attachment.id)).toEqual(["file-test"]);

    const anonymous = await post(app, "/api/projects/project-test/delete", { password, version: stillThere.version });
    expect(anonymous.status).toBe(401);

    const removed = await post(
      app,
      "/api/projects/project-test/delete",
      { password, version: stillThere.version },
      cookie,
    );
    expect(removed.status).toBe(200);
    const afterDelete = (await removed.json()) as Board;
    expect(afterDelete.snapshot.projects.map((project) => project.id)).toEqual(["project-keep"]);
    expect(afterDelete.snapshot.tasks.map((task) => task.id)).toEqual(["task-keep"]);
    expect(afterDelete.snapshot.comments.map((comment) => comment.id)).toEqual(["comment-keep"]);
    expect(afterDelete.snapshot.attachments).toEqual([]);
    expect(afterDelete.snapshot.users.map((user) => user.name)).toEqual(["One Member"]);

    const refreshed = (await (await app.request("/api/workspace", { headers: { cookie } })).json()) as Board;
    expect(refreshed.snapshot.projects.map((project) => project.name)).toEqual(["Keep"]);
    expect(refreshed.snapshot.tasks.map((task) => task.title)).toEqual(["Stay"]);

    const signed = await post(app, "/api/projects/project-keep/sign-off", { version: refreshed.version }, cookie);
    expect(signed.status).toBe(200);
    const signedBody = (await signed.json()) as Board;
    expect(signedBody.snapshot.projects[0]?.signOff).toMatchObject({ name: "One Member" });
    expect(signedBody.snapshot.projects[0]?.signOff?.at).toBeTruthy();
    expect(signedBody.snapshot.tasks.map((task) => task.id)).toEqual(["task-keep"]);

    const afterRefresh = (await (await app.request("/api/workspace", { headers: { cookie } })).json()) as Board;
    expect(afterRefresh.snapshot.projects[0]?.signOff?.name).toBe("One Member");

    const forged = structuredClone(afterRefresh.snapshot);
    forged.projects[0] = { ...forged.projects[0], client: "Updated client", signOff: null };
    forged.projects.push({
      id: "project-new",
      name: "New",
      color: "#2f7d4a",
      client: "Other",
      deadline: null,
      createdAt: "2026-10-13T00:00:00.000Z",
      signOff: { userId: "someone", name: "Someone", at: "2020-01-01T00:00:00.000Z" },
    });
    const edited = await app.request("/api/workspace", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ version: afterRefresh.version, snapshot: forged }),
    });
    expect(edited.status).toBe(200);
    const editedBody = (await edited.json()) as Board;
    const kept = editedBody.snapshot.projects.find((project) => project.id === "project-keep");
    const created = editedBody.snapshot.projects.find((project) => project.id === "project-new");
    expect(kept?.client).toBe("Updated client");
    expect(kept?.signOff?.name).toBe("One Member");
    expect(created?.signOff).toBeNull();

    const stripped = structuredClone(editedBody.snapshot);
    stripped.projects = stripped.projects.filter((project) => project.id !== "project-keep");
    const blocked = await app.request("/api/workspace", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ version: editedBody.version, snapshot: stripped }),
    });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ message: "A project can only be removed with Delete project." });

    const reopened = await post(app, "/api/projects/project-keep/reopen", { version: editedBody.version }, cookie);
    expect(reopened.status).toBe(200);
    const reopenedBody = (await reopened.json()) as Board;
    expect(reopenedBody.snapshot.projects.find((project) => project.id === "project-keep")?.signOff).toBeNull();
    expect(reopenedBody.snapshot.tasks.map((task) => task.id)).toEqual(["task-keep"]);

    const finalBoard = (await (await app.request("/api/workspace", { headers: { cookie } })).json()) as Board;
    expect(finalBoard.snapshot.projects.find((project) => project.id === "project-keep")?.signOff).toBeNull();
    expect(finalBoard.snapshot.projects.map((project) => project.id)).toContain("project-keep");
    expect(finalBoard.snapshot.users.map((user) => user.name)).toEqual(["One Member"]);
  });
});
