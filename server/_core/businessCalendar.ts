import holidayJp from "@holiday-jp/holiday_jp";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** YYYY-MM-DD形式の日付を、暦日として安全に扱うUTC Dateへ変換する。 */
export function parseDateOnly(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date-only value: ${date}`);
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/** 実行時点の日本時間の日付をYYYY-MM-DD形式で返す。 */
export function getJstDate(offsetDays = 0, now = new Date()): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  jst.setUTCDate(jst.getUTCDate() + offsetDays);
  return jst.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const value = parseDateOnly(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 土日および日本の国民の祝日を休業日として判定する。 */
export function isJapaneseBusinessDay(date: string): boolean {
  const value = parseDateOnly(date);
  const day = value.getUTCDay();
  return day !== 0 && day !== 6 && !holidayJp.isHoliday(date);
}

export function nextJapaneseBusinessDay(date: string): string {
  let candidate = date;
  while (!isJapaneseBusinessDay(candidate)) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

export function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

export type DueNotificationPlan =
  | { kind: "today"; targetDates: [string] }
  | { kind: "tomorrow"; targetDates: [string] }
  | { kind: "beforeNonBusinessDays"; targetDates: string[] };

/**
 * 期限通知の送信対象を決定する。
 *
 * 土日祝には送信せず、次の日が休業日に入る営業日の朝に、休業日中と
 * 翌営業日が期限のタスクを一括で通知する。翌営業日分を含めることで、
 * 本来は休業日に送る「前日通知」も前営業日に前倒しできる。
 */
export function getDueNotificationPlan(
  kind: "today" | "tomorrow",
  today = getJstDate(),
): DueNotificationPlan | null {
  if (!isJapaneseBusinessDay(today)) return null;

  if (kind === "today") {
    return { kind: "today", targetDates: [today] };
  }

  const tomorrow = addDays(today, 1);
  if (isJapaneseBusinessDay(tomorrow)) {
    return { kind: "tomorrow", targetDates: [tomorrow] };
  }

  const nextBusinessDay = nextJapaneseBusinessDay(tomorrow);
  return {
    kind: "beforeNonBusinessDays",
    targetDates: getDateRange(tomorrow, nextBusinessDay),
  };
}
