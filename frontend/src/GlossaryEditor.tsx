import { useTranslation } from "./i18n";
import type { JSX } from "react";
type Term = { source: string; target: string };
export function GlossaryEditor({
  value,
  onChange,
}: {
  value: Term[];
  onChange: (value: Term[]) => void;
}): JSX.Element {
  const { t } = useTranslation();

  return (
    <fieldset className="glossary-editor">
      <legend>{t("Glossary")} </legend>
      {value.map((term, index) => (
        <div className="language-fields" key={index}>
          <label>
            {t("Source term")}{" "}
            <input
              data-testid={`glossary-source-${index}`}
              value={term.source}
              maxLength={100}
              onChange={(event) =>
                onChange(
                  value.map((item, i) =>
                    i === index
                      ? { ...item, source: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          <label>
            {t("Target term")}{" "}
            <input
              data-testid={`glossary-target-${index}`}
              value={term.target}
              maxLength={100}
              onChange={(event) =>
                onChange(
                  value.map((item, i) =>
                    i === index
                      ? { ...item, target: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            {t("Remove")}{" "}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        data-testid="add-glossary-term"
        disabled={value.length >= 100}
        onClick={() => onChange([...value, { source: "", target: "" }])}
      >
        {t("+ Add term")}{" "}
      </button>
    </fieldset>
  );
}
