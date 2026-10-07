import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({}));
vi.mock("./_core/geminiSync", () => ({
  disableGeminiSync: vi.fn(),
  getGeminiSyncStatus: vi.fn(),
  triggerGeminiSync: vi.fn(),
}));
vi.mock("./_core/googleAuth", () => ({ clearGoogleSession: vi.fn() }));
vi.mock("./_core/mailer", () => ({ sendInvitationEmail: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));

const { appRouter } = await import("./routers");

function createContext() {
  return {
    user: {
      id: 1,
      openId: "google-user",
      email: "member@b-bloom.jp",
      name: "テスト利用者",
      loginMethod: "google",
      role: "user" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: {}, cookies: {} },
    res: { clearCookie: vi.fn(), cookie: vi.fn() },
  } as any;
}

describe("task assignee requirement", () => {
  it("rejects a new task without an assignee before database access", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(caller.task.create({
      id: "task-1",
      projectId: "project-1",
      colId: "column-1",
      title: "担当者なしのタスク",
      assignee: "   ",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects clearing an existing task assignee", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(caller.task.update({
      id: "task-1",
      assignee: "",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects CSV imports without the assignee column before creating a project", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(caller.import.jootoCSV({
      projectName: "担当者必須テスト",
      csvContent: "リスト名*,タスク名*\n未対応,担当者なしのタスク",
    })).rejects.toThrow("タスク担当者");
  });
});
