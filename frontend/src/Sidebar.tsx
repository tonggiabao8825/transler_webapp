import { useTranslation } from "./i18n";
import type { JSX } from "react";
import {
  Home,
  Languages,
  FilePenLine,
  Repeat2,
  LayoutGrid,
  Folder,
  Star,
  Users,
  Trash2,
  Sparkles,
  UserRound,
  ShieldCheck,
} from "lucide-react";

export type Screen =
  | "notfound"
  | "auth"
  | "account"
  | "admin"
  | "landing"
  | "home"
  | "translate"
  | "settings"
  | "job"
  | "library"
  | "editor"
  | "convert"
  | "tools"
  | "favorites"
  | "shared"
  | "trash";
type SidebarProps = {
  screen: Screen;
  isAdmin: boolean;
  planCode: string;
  documentCount: number;
  onNavigate: (screen: Screen) => void;
  onUpgrade: () => void;
};
const navigation = [
  { id: "home", label: "Home", icon: Home },
  { id: "translate", label: "Translate", icon: Languages },
  { id: "editor", label: "Edit PDF", icon: FilePenLine },
  { id: "convert", label: "Convert", icon: Repeat2 },
  { id: "tools", label: "All Tools", icon: LayoutGrid },
] as const;
const library = [
  { id: "library", label: "My Documents", icon: Folder },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "shared", label: "Shared", icon: Users },
  { id: "trash", label: "Trash", icon: Trash2 },
] as const;
export function Sidebar({
  screen,
  isAdmin,
  planCode,
  documentCount,
  onNavigate,
  onUpgrade,
}: SidebarProps): JSX.Element {
  const { t } = useTranslation();

  const active = ["settings", "job"].includes(screen) ? "translate" : screen;
  return (
    <aside className="sidebar">
      <button
        className="brand"
        data-testid="brand"
        onClick={() => onNavigate("home")}
        aria-label={t("Transler home")}
      >
        <img src="/assets/brand/logo-symbol.svg" alt="" />
        <span>Transler.</span>
      </button>
      <nav aria-label={t("Main navigation")}>
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-testid={`nav-${id}`}
            aria-label={t(label)}
            aria-current={active === id ? "page" : undefined}
            className={`nav-item ${active === id ? "active" : ""}`}
            onClick={() => onNavigate(id)}
          >
            <Icon size={17} />
            <span>{t(label)}</span>
          </button>
        ))}
      </nav>
      <div className="workspace-label">{t("Library")} </div>
      <nav aria-label={t("Library")}>
        {library.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-testid={`nav-${id}`}
            aria-label={t(label)}
            aria-current={active === id ? "page" : undefined}
            className={`nav-item ${active === id ? "active" : ""}`}
            onClick={() => onNavigate(id)}
          >
            <Icon size={17} />
            <span>{t(label)}</span>
            {id === "library" && documentCount > 0 && (
              <small className="nav-count">{documentCount}</small>
            )}
          </button>
        ))}
      </nav>
      <nav aria-label={t("Account")}>
        <button
          data-testid="nav-account"
          className={`nav-item ${screen === "account" ? "active" : ""}`}
          onClick={() => onNavigate("account")}
        >
          <UserRound size={17} />
          <span>{t("My account")} </span>
        </button>
        {isAdmin && (
          <button
            data-testid="nav-admin"
            className={`nav-item ${screen === "admin" ? "active" : ""}`}
            onClick={() => onNavigate("admin")}
          >
            <ShieldCheck size={17} />
            <span>{t("Administration")} </span>
          </button>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="upgrade-card">
          <Sparkles size={16} />
          <strong>
            {planCode === "free"
              ? t("Upgrade to Pro")
              : `${planCode} ${t("plan active")}`}
          </strong>
          <p>
            {planCode === "free"
              ? t("More translated pages and saved documents.")
              : t("View your usage, plan and billing details.")}
          </p>
          <button
            className="button primary"
            data-testid="upgrade-plan"
            onClick={onUpgrade}
          >
            {planCode === "free" ? t("Upgrade") : t("Manage plan")}
          </button>
        </div>
        <a className="website-link" data-testid="discover-transler" href="/">
          {t("Discover Transler ↗")}{" "}
        </a>
      </div>
    </aside>
  );
}
