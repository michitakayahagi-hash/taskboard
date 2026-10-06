import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  getTaskById: vi.fn(),
  getDueHistory: vi.fn(),
  updateTask: vi.fn(),
  addDueHistory: vi.fn(),
  getPendingDueChangeRequest: vi.fn(),
  createDueChangeRequest: vi.fn(),
  updatePendingDueChangeRequest: vi.fn(),
  listPendingDueChangeRequests: vi.fn(),
  approveDueChangeRequest: vi.fn(),
  rejectDueChangeRequest: vi.fn(),
  getProjectById: vi.fn(),
  getMemberByEmailAndProject: vi.fn(),
  getSetting: vi.fn(),
};

vi.mock("./db", () => db);
vi.mock("./_core/geminiSync", () => ({
  disableGeminiSync: vi.fn(),
  getGeminiSyncStatus: vi.fn(),
  triggerGeminiSync: vi.fn(),
}));
vi.mock("./_core/googleAuth", () => ({ clearGoogleSession: vi.fn() }));
vi.mock("./_core/mailer", () => ({ sendInvitationEmail: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn() }));

const { appRouter } = await import("./routers");

function createContext(email: string, name = "テスト利用者") {
  return {
    user: {
      id: 1,
      openId: "google-user",
      email,
      name,
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

const existingTask = {
  id: "task-1",
  projectId: "project-1",
  title: "期限テスト",
  due: "2026-10-10",
  dueStart: "2026-10-01",
};

describe("due change approval routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getTaskById.mockResolvedValue(existingTask);
    db.getProjectById.mockResolvedValue({ id: "project-1", isPublic: true });
    db.getMemberByEmailAndProject.mockResolvedValue(null);
    db.getSetting.mockResolvedValue(null);
  });

  it("applies the first deadline change immediately and records it", async () => {
    db.getDueHistory.mockResolvedValue([]);
    const caller = appRouter.createCaller(createContext("member@b-bloom.jp"));

    await expect(caller.dueChange.request({ taskId: "task-1", due: "2026-10-12" }))
      .resolves.toEqual({ status: "applied" });

    expect(db.updateTask).toHaveBeenCalledWith("task-1", { due: "2026-10-12", dueStart: "2026-10-01" });
    expect(db.addDueHistory).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      prevDue: "2026-10-10",
      newDue: "2026-10-12",
    }));
  });

  it("queues subsequent deadline changes without changing the task", async () => {
    db.getDueHistory.mockResolvedValue([{ id: 1 }]);
    db.getPendingDueChangeRequest
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 9, taskId: "task-1", requesterName: "テスト利用者" });
    const caller = appRouter.createCaller(createContext("member@b-bloom.jp"));

    await expect(caller.dueChange.request({ taskId: "task-1", dueStart: "2026-10-02" }))
      .resolves.toEqual({ status: "pending", requestId: 9 });

    expect(db.updateTask).not.toHaveBeenCalled();
    expect(db.createDueChangeRequest).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      prevDueStart: "2026-10-01",
      requestedDueStart: "2026-10-02",
      requestedDue: "2026-10-10",
      requesterEmail: "member@b-bloom.jp",
    }));
  });

  it("allows the requester to revise a pending deadline proposal without bypassing approval", async () => {
    db.getDueHistory.mockResolvedValue([{ id: 1 }]);
    db.getPendingDueChangeRequest
      .mockResolvedValueOnce({ id: 9, taskId: "task-1", requesterEmail: "member@b-bloom.jp", requesterName: "テスト利用者" })
      .mockResolvedValueOnce({ id: 9, taskId: "task-1", requesterEmail: "member@b-bloom.jp", requesterName: "テスト利用者", requestedDue: "2026-10-14", requestedDueStart: "2026-10-03" });
    const caller = appRouter.createCaller(createContext("member@b-bloom.jp"));

    await expect(caller.dueChange.request({ taskId: "task-1", due: "2026-10-14", dueStart: "2026-10-03" }))
      .resolves.toEqual({ status: "pending_updated", requestId: 9 });

    expect(db.updateTask).not.toHaveBeenCalled();
    expect(db.updatePendingDueChangeRequest).toHaveBeenCalledWith(9, expect.objectContaining({
      requestedDue: "2026-10-14",
      requestedDueStart: "2026-10-03",
      requesterEmail: "member@b-bloom.jp",
    }));
  });

  it("blocks a non-member from changing a deadline in a restricted project", async () => {
    db.getProjectById.mockResolvedValue({ id: "project-1", isPublic: false });
    const caller = appRouter.createCaller(createContext("unregistered@b-noix.jp"));

    await expect(caller.dueChange.request({ taskId: "task-1", due: "2026-10-12" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(db.updateTask).not.toHaveBeenCalled();
  });

  it("limits an allowlisted external account to its explicitly assigned public project", async () => {
    const previousExternalEmails = process.env.TASKBOARD_ALLOWED_EXTERNAL_EMAILS;
    process.env.TASKBOARD_ALLOWED_EXTERNAL_EMAILS = "kisaragi.0205.star@gmail.com";
    db.getProjectById.mockResolvedValue({ id: "project-1", isPublic: true });
    const caller = appRouter.createCaller(createContext("kisaragi.0205.star@gmail.com"));

    try {
      await expect(caller.dueChange.request({ taskId: "task-1", due: "2026-10-12" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });

      db.getMemberByEmailAndProject.mockResolvedValue({ id: 8, role: "editor", isAdmin: false });
      db.getDueHistory.mockResolvedValue([]);
      await expect(caller.dueChange.request({ taskId: "task-1", due: "2026-10-12" }))
        .resolves.toEqual({ status: "applied" });
    } finally {
      if (previousExternalEmails === undefined) delete process.env.TASKBOARD_ALLOWED_EXTERNAL_EMAILS;
      else process.env.TASKBOARD_ALLOWED_EXTERNAL_EMAILS = previousExternalEmails;
    }
  });

  it("allows only Michitaka Yahagi to approve a queued change", async () => {
    const queuedRequest = { id: 9, taskId: "task-1", requesterName: "テスト利用者", prevDue: "2026-10-10", prevDueStart: "2026-10-01", requestedDue: "2026-10-12", requestedDueStart: "2026-10-02" };
    db.approveDueChangeRequest.mockResolvedValue({ request: queuedRequest, applied: true });

    const requester = appRouter.createCaller(createContext("member@b-bloom.jp"));
    await expect(requester.dueChange.approve({ id: 9 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const approver = appRouter.createCaller(createContext("michitakayahagi@b-bloom.jp", "矢作充隆"));
    await expect(approver.dueChange.approve({ id: 9 })).resolves.toEqual({ success: true, applied: true, taskId: "task-1" });
    expect(db.approveDueChangeRequest).toHaveBeenCalledWith(9, { email: "michitakayahagi@b-bloom.jp", name: "矢作充隆" });
  });
});
