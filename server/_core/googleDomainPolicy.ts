const DEFAULT_ALLOWED_GOOGLE_DOMAINS = ["b-bloom.jp"];

/**
 * GOOGLE_ALLOWED_DOMAIN は後方互換のため単数形のまま、カンマ区切りで複数ドメインを受け付ける。
 * 例: b-bloom.jp,b-noix.jp
 */
export function getAllowedGoogleDomains(rawValue = process.env.GOOGLE_ALLOWED_DOMAIN): string[] {
  const configured = (rawValue || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter((domain) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain));

  return Array.from(new Set(configured.length > 0 ? configured : DEFAULT_ALLOWED_GOOGLE_DOMAINS));
}

export function isAllowedGoogleWorkspaceEmail(email: unknown, rawValue = process.env.GOOGLE_ALLOWED_DOMAIN): boolean {
  if (typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return false;
  return getAllowedGoogleDomains(rawValue).includes(normalized.slice(at + 1));
}

/** Google OAuthのhdは単一ドメインしか指定できないため、複数許可時は省略してIDトークンで検証する。 */
export function getGoogleHostedDomainHint(rawValue = process.env.GOOGLE_ALLOWED_DOMAIN): string | null {
  const domains = getAllowedGoogleDomains(rawValue);
  return domains.length === 1 ? domains[0] : null;
}

export function allowedGoogleDomainLabel(rawValue = process.env.GOOGLE_ALLOWED_DOMAIN): string {
  return getAllowedGoogleDomains(rawValue).map((domain) => `@${domain}`).join(" または ");
}
