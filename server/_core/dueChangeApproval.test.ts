import { describe, expect, it } from "vitest";
import {
  deadlineValuesChanged,
  getDueChangeApproverEmail,
  isDueChangeApprover,
  normalizeDueDate,
} from "./dueChangeApproval";

describe("due change approval policy", () => {
  it("uses Michitaka Yahagi as the default and accepts a configured override", () => {
    expect(getDueChangeApproverEmail({})).toBe("michitakayahagi@b-bloom.jp");
    expect(getDueChangeApproverEmail({ TASKBOARD_DUE_CHANGE_APPROVER_EMAIL: " APPROVER@B-BLOOM.JP " })).toBe("approver@b-bloom.jp");
  });

  it("restricts approvals to the designated email address", () => {
    const env = { TASKBOARD_DUE_CHANGE_APPROVER_EMAIL: "michitakayahagi@b-bloom.jp" };
    expect(isDueChangeApprover("MichitakaYahagi@b-bloom.jp", env)).toBe(true);
    expect(isDueChangeApprover("other@b-bloom.jp", env)).toBe(false);
  });

  it("treats empty dates consistently and detects either date boundary changing", () => {
    expect(normalizeDueDate("")).toBeNull();
    expect(deadlineValuesChanged({ due: null, dueStart: null }, { due: "", dueStart: "" })).toBe(false);
    expect(deadlineValuesChanged({ due: "2026-09-30", dueStart: "2026-09-20" }, { due: "2026-10-01", dueStart: "2026-09-20" })).toBe(true);
    expect(deadlineValuesChanged({ due: "2026-09-30", dueStart: "2026-09-20" }, { due: "2026-09-30", dueStart: "2026-09-19" })).toBe(true);
  });
});
