export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// 未認証のAPI応答時は、現在の画面へ戻れるGoogle Workspaceログイン画面に遷移する。
export const getLoginUrl = () => {
  const currentPath = `${window.location.pathname}${window.location.search}`;
  return `/login?next=${encodeURIComponent(currentPath)}`;
};
