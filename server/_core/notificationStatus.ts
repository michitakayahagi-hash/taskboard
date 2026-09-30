/**
 * 通知から除外するタスクステータス。
 * 保留タスクは期限が設定されていても、期限超過・期限未設定・前日・当日の
 * いずれの通知にも含めない。
 */
export const NOTIFICATION_EXCLUDED_TASK_STATUS = "保留";

export function isNotificationExcludedTaskStatus(status: unknown): boolean {
  return typeof status === "string" && status.trim() === NOTIFICATION_EXCLUDED_TASK_STATUS;
}
