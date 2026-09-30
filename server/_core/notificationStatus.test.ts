import { describe, expect, it } from "vitest";
import { isNotificationExcludedTaskStatus } from "./notificationStatus";

describe("notification status rules", () => {
  it("excludes hold-status tasks from every deadline notification", () => {
    expect(isNotificationExcludedTaskStatus("保留")).toBe(true);
    expect(isNotificationExcludedTaskStatus(" 保留 ")).toBe(true);
  });

  it("keeps other task statuses eligible for their usual notification rules", () => {
    expect(isNotificationExcludedTaskStatus("未対応")).toBe(false);
    expect(isNotificationExcludedTaskStatus("対応中")).toBe(false);
    expect(isNotificationExcludedTaskStatus("")).toBe(false);
    expect(isNotificationExcludedTaskStatus(null)).toBe(false);
    expect(isNotificationExcludedTaskStatus(undefined)).toBe(false);
  });
});
