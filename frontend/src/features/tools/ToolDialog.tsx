import { X } from "lucide-react";
import { useEffect, useRef, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../shared/i18n/i18n";

type Props = { title: string; onClose: () => void; children: ReactNode };

export function ToolDialog({ title, onClose, children }: Props): JSX.Element {
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
      className="tool-dialog"
      data-testid="tool-dialog"
      aria-labelledby="tool-dialog-title"
      onCancel={onClose}
    >
      <header>
        <h2 id="tool-dialog-title">{title}</h2>
        <button
          className="icon-button"
          data-testid="tool-dialog-close"
          aria-label={t("Close tool")}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
