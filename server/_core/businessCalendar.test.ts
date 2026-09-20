import { describe, expect, it } from "vitest";
import {
  getDueNotificationPlan,
  isJapaneseBusinessDay,
  nextJapaneseBusinessDay,
} from "./businessCalendar";

describe("Japanese business calendar", () => {
  it("treats weekends and national holidays as non-business days", () => {
    expect(isJapaneseBusinessDay("2026-09-19")).toBe(false); // Saturday
    expect(isJapaneseBusinessDay("2026-09-21")).toBe(false); // Respect for the Aged Day
    expect(isJapaneseBusinessDay("2026-09-24")).toBe(true);
  });

  it("finds the first business day after a consecutive holiday period", () => {
    expect(nextJapaneseBusinessDay("2026-09-19")).toBe("2026-09-24");
  });

  it("keeps ordinary weekday notifications on their existing schedule", () => {
    expect(getDueNotificationPlan("today", "2026-09-15")).toEqual({
      kind: "today",
      targetDates: ["2026-09-15"],
    });
    expect(getDueNotificationPlan("tomorrow", "2026-09-15")).toEqual({
      kind: "tomorrow",
      targetDates: ["2026-09-16"],
    });
  });

  it("does not send any scheduled notice on a holiday", () => {
    expect(getDueNotificationPlan("today", "2026-09-21")).toBeNull();
    expect(getDueNotificationPlan("tomorrow", "2026-09-21")).toBeNull();
  });

  it("groups non-business-day and next-business-day deadlines on the prior business day", () => {
    expect(getDueNotificationPlan("tomorrow", "2026-09-18")).toEqual({
      kind: "beforeNonBusinessDays",
      targetDates: [
        "2026-09-19",
        "2026-09-20",
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
      ],
    });
  });
});
