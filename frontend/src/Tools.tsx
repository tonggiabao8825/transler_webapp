import { toolAvailable } from "./tool-contracts";
import { useToolAvailability } from "./ToolAvailability";
import { useTranslation } from "./i18n";
import type { JSX } from "react";
import {
  Combine,
  Scissors,
  Minimize2,
  Images,
  FileImage,
  Shield,
  LockKeyhole,
} from "lucide-react";
import type { PDFToolKind } from "./PDFTools";
import type { Screen } from "./Sidebar";

export const primaryTools = [
  {
    id: "translate",
    title: "Translate PDF",
    subtitle: "Keep original layout",
    asset: "translate-pdf",
  },
  {
    id: "editor",
    title: "Edit PDF",
    subtitle: "Crop, replace, adjust",
    asset: "edit-pdf",
  },
  {
    id: "convert",
    title: "Convert Files",
    subtitle: "PDF to Word, PPT, etc.",
    asset: "convert",
  },
  {
    id: "documents",
    title: "Translate Documents",
    subtitle: "Word, PPT, Excel, and more",
    asset: "translate-docs",
  },
] as const;
type ToolsProps = {
  onNavigate: (screen: Screen) => void;
  onPlanned: (feature: string) => void;
};
export function ToolCards({ onNavigate }: ToolsProps): JSX.Element {
  const { t } = useTranslation();
  const { settings } = useToolAvailability();
  return (
    <div className="tool-cards">
      {primaryTools.map((tool) => (
        <button
          key={tool.id}
          data-testid={`tool-${tool.id}`}
          className={`tool-card tool-${tool.id}`}
          disabled={!toolAvailable(settings, tool.id)}
          title={
            settings && !toolAvailable(settings, tool.id)
              ? t("Disabled by administrator")
              : undefined
          }
          onClick={() =>
            tool.id === "documents" ? onNavigate("tools") : onNavigate(tool.id)
          }
        >
          <img src={`/assets/icons/${tool.asset}.svg`} alt="" />
          <strong>{t(tool.title)}</strong>
          <small>{t(tool.subtitle)}</small>
          {settings && !toolAvailable(settings, tool.id) && (
            <span className="tool-disabled-label">{t("Disabled")}</span>
          )}
        </button>
      ))}
    </div>
  );
}
export const additionalTools = [
  {
    id: "ocr",
    kind: "ocr",
    title: "OCR",
    subtitle: "Extract text from images",
    icon: null,
    asset: "ocr",
  },
  {
    id: "merge",
    kind: "merge",
    title: "Merge PDF",
    subtitle: "Combine multiple files",
    icon: Combine,
    asset: null,
  },
  {
    id: "split",
    kind: "split",
    title: "Split PDF",
    subtitle: "Extract pages",
    icon: Scissors,
    asset: null,
  },
  {
    id: "compress",
    kind: "compress",
    title: "Compress PDF",
    subtitle: "Reduce file size",
    icon: Minimize2,
    asset: null,
  },
  {
    kind: null,
    id: "pdf_to_images",
    title: "PDF to Images",
    subtitle: "Export pages as images",
    icon: Images,
    asset: null,
  },
  {
    kind: null,
    id: "images_to_pdf",
    title: "Images to PDF",
    subtitle: "Create PDF from images",
    icon: FileImage,
    asset: null,
  },
  {
    id: "protect",
    kind: "protect",
    title: "Protect PDF",
    subtitle: "Add password protection",
    icon: Shield,
    asset: null,
  },
  {
    id: "unlock",
    kind: "unlock",
    title: "Unlock PDF",
    subtitle: "Remove password protection",
    icon: LockKeyhole,
    asset: null,
  },
] as const;
export function AllTools({
  onNavigate,
  onPlanned,
  onPDFTool,
}: ToolsProps & { onPDFTool: (tool: PDFToolKind) => void }): JSX.Element {
  const { t } = useTranslation();
  const { settings } = useToolAvailability();

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t("All Tools")} </h1>
          <p>{t("Everything you need to work with documents.")} </p>
        </div>
      </div>
      <section className="all-tools-grid">
        <ToolCards onNavigate={onNavigate} onPlanned={onPlanned} />
        {additionalTools.map(
          ({ id, title, subtitle, icon: Icon, asset, kind }) => (
            <button
              key={title}
              className="tool-card"
              disabled={!toolAvailable(settings, id)}
              title={
                settings && !toolAvailable(settings, id)
                  ? t("Disabled by administrator")
                  : undefined
              }
              data-testid={`planned-${title.toLowerCase().replaceAll(" ", "-")}`}
              onClick={() => {
                if (kind === null) onNavigate("convert");
                else onPDFTool(kind);
              }}
            >
              {Icon ? (
                <span className="tool-icon">
                  <Icon size={22} />
                </span>
              ) : (
                <img src={`/assets/icons/${asset}.svg`} alt="" />
              )}
              <strong>{t(title)}</strong>
              <small>{t(subtitle)}</small>
              {settings && !toolAvailable(settings, id) && (
                <span className="tool-disabled-label">{t("Disabled")}</span>
              )}
            </button>
          ),
        )}
      </section>
    </>
  );
}
