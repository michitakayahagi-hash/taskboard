export const DEFAULT_DUE_CHANGE_APPROVER_EMAIL = "michitakayahagi@b-bloom.jp";

type ApprovalEnvironment = Record<string, string | undefined>;

export function getDueChangeApproverEmail(env: ApprovalEnvironment = process.env): string {
  return (env.TASKBOARD_DUE_CHANGE_APPROVER_EMAIL || DEFAULT_DUE_CHANGE_APPROVER_EMAIL)
    .trim()
    .toLowerCase();
}

export function isDueChangeApprover(email?: string | null, env: ApprovalEnvironment = process.env): boolean {
  return !!email && email.trim().toLowerCase() === getDueChangeApproverEmail(env);
}

export function normalizeDueDate(value?: string | null): string | null {
  const normalized = value?.trim() || "";
  return normalized || null;
}

export function deadlineValuesChanged(
  current: { due?: string | null; dueStart?: string | null },
  requested: { due?: string | null; dueStart?: string | null }
): boolean {
  return normalizeDueDate(current.due) !== normalizeDueDate(requested.due)
    || normalizeDueDate(current.dueStart) !== normalizeDueDate(requested.dueStart);
}
