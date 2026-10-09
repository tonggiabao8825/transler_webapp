import { useTranslation } from "./i18n";
import { useEffect, useRef, useState, type JSX } from "react";
import {
  Undo2,
  Redo2,
  Type,
  Pencil,
  StickyNote,
  Crop,
  MoreHorizontal,
  RotateCw,
  ArrowLeftRight,
  GitMerge,
  Scissors,
  Printer,
  Search,
  Save,
  Download,
} from "lucide-react";
import type { EditOperation } from "./api";
type Props = {
  action: EditOperation["type"];
  canUndo: boolean;
  canRedo: boolean;
  canSave: boolean;
  busy: boolean;
  artifactId: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onAction: (action: EditOperation["type"]) => void;
  onTools: () => void;
  onSearch: () => void;
};
const primaryTools = [
  { action: "replace_text", label: "Edit text", icon: Pencil, id: "edit" },
  { action: "add_text", label: "Add text", icon: Type, id: "add" },
  {
    action: "retranslate_region",
    label: "Translate region",
    icon: Crop,
    id: "crop",
  },
  { action: "add_annotation", label: "Note", icon: StickyNote, id: "note" },
] as const;
export function EditorToolbar(props: Props): JSX.Element {
  const { t } = useTranslation();

  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function dismiss(event: PointerEvent): void {
      if (event.target instanceof Node && !menu.current?.contains(event.target))
        setMenuOpen(false);
    }
    function escape(event: KeyboardEvent): void {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  const available = props.artifactId !== null && !props.busy;
  return (
    <header className="pdf-editor-ribbon" aria-label={t("PDF editing tools")}>
      <div className="pdf-ribbon-group pdf-editor-history">
        <button
          data-testid="editor-undo"
          aria-label={t("Undo")}
          title={t("Undo")}
          disabled={!props.canUndo || props.busy}
          onClick={props.onUndo}
        >
          <Undo2 />
        </button>
        <button
          data-testid="editor-redo"
          aria-label={t("Redo")}
          title={t("Redo")}
          disabled={!props.canRedo || props.busy}
          onClick={props.onRedo}
        >
          <Redo2 />
        </button>
      </div>
      <div className="pdf-editor-primary-tools">
        {primaryTools.map(({ action, label, icon: Icon, id }) => (
          <button
            key={id}
            data-testid={`editor-tool-${id}`}
            disabled={!available}
            aria-label={t(label)}
            aria-pressed={props.action === action}
            title={t(label)}
            className={props.action === action ? "active" : ""}
            onClick={() => props.onAction(action)}
          >
            <Icon />
            <span>{t(label)}</span>
          </button>
        ))}
        <details className="pdf-editor-more" ref={menu} open={menuOpen}>
          <summary
            data-testid="editor-more"
            aria-label={t("More tools")}
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.preventDefault();
              setMenuOpen((current) => !current);
            }}
          >
            <MoreHorizontal />
            <span>{t("More")} </span>
          </summary>
          <div
            className="pdf-editor-menu"
            onClick={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest("button,a")
              )
                setMenuOpen(false);
            }}
          >
            <button
              data-testid="editor-rotate"
              disabled={!available}
              onClick={() => props.onAction("rotate_page")}
            >
              <RotateCw />
              {t("Rotate page")}{" "}
            </button>
            <button
              disabled={!available}
              onClick={() => props.onAction("reorder_pages")}
            >
              <ArrowLeftRight />
              {t("Reorder pages")}{" "}
            </button>
            <button data-testid="editor-merge" onClick={props.onTools}>
              <GitMerge />
              {t("Merge PDFs")}{" "}
            </button>
            <button data-testid="editor-split" onClick={props.onTools}>
              <Scissors />
              {t("Split PDF")}{" "}
            </button>
            <button
              data-testid="editor-search-toggle"
              disabled={!available}
              onClick={props.onSearch}
            >
              <Search />
              {t("Find in document")}{" "}
            </button>
            {props.artifactId && (
              <a
                href={`/v1/artifacts/${props.artifactId}/preview`}
                target="_blank"
                rel="noreferrer"
              >
                <Printer />
                {t("Open for printing")}{" "}
              </a>
            )}
            <p>
              {t(
                "Signature, drawing and image insertion are not available yet.",
              )}{" "}
            </p>
          </div>
        </details>
      </div>
      <div className="pdf-ribbon-output">
        {props.artifactId && (
          <a
            className="pdf-editor-export"
            aria-label={t("Download PDF")}
            title={t("Download PDF")}
            href={`/v1/artifacts/${props.artifactId}/download`}
          >
            <Download />
            <span>{t("Export")} </span>
          </a>
        )}
        <button
          data-testid="editor-save"
          className="pdf-editor-save"
          disabled={!props.canSave || props.busy}
          onClick={props.onSave}
        >
          <Save />
          <span>{props.busy ? t("Saving…") : t("Save")}</span>
        </button>
      </div>
    </header>
  );
}
