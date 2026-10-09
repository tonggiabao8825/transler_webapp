import type { Screen } from "./Sidebar";
export const routes: Record<Screen, string> = {
  landing: "/",
  auth: "/login",
  home: "/dashboard",
  account: "/account",
  admin: "/admin",
  translate: "/translate",
  settings: "/translate/settings",
  job: "/translations",
  library: "/documents",
  editor: "/editor",
  convert: "/convert",
  tools: "/tools",
  favorites: "/favorites",
  shared: "/shared",
  trash: "/trash",
  notfound: "/404",
};
export function readRoute(path: string): Screen {
  if (path === "/register") return "auth";
  if (path === "/welcome") return "landing";
  const result = (Object.entries(routes) as Array<[Screen, string]>).find(
    ([, url]) => url === path,
  );
  return result ? result[0] : "notfound";
}
