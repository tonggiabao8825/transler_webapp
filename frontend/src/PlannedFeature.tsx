import { useTranslation } from "./i18n";
import type { JSX } from "react";
import { useEffect, useRef } from "react";
import { X, Sparkles } from "lucide-react";
type PlannedFeatureProps = { feature: string; onClose: () => void };
export function PlannedFeature({
  feature,
  onClose,
}: PlannedFeatureProps): JSX.Element {
  const { t } = useTranslation();

  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const current = dialog.current;
    current?.showModal();
    return () => {
      current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="planned-dialog"
      onCancel={onClose}
      aria-labelledby="planned-title"
      data-testid="planned-feature"
    >
      <button
        className="icon-button modal-close"
        data-testid="close-planned"
        aria-label={t("Close")}
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <div className="planned-icon">
        <Sparkles size={27} />
      </div>
      <span className="phase-label">{t("Coming in a later phase")} </span>
      <h2 id="planned-title">{feature}</h2>
      <p>
        {t(
          "This feature is designed and reserved for an upcoming phase. PDF translation and your document library are available now.",
        )}{" "}
      </p>
      <div className="skeleton-preview" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <button className="button primary" onClick={onClose}>
        {t("Back to workspace")}{" "}
      </button>
    </dialog>
  );
}
