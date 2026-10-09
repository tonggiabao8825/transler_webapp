import { Select, SelectOption } from "./Select";
import { localizedLanguageName, useTranslation } from "./i18n";
import { GlossaryEditor } from "./GlossaryEditor";
import { useState } from "react";
import type { TranslationOptions } from "./api";
import type { JSX } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Languages,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  languages,
  languageSchema,
  sourceLanguageSchema,
  type Document,
  type Language,
  type SourceLanguage,
} from "./api";

type TranslationSettingsProps = {
  document: Document;
  source: SourceLanguage;
  target: Language;
  busy: boolean;
  onBack: () => void;
  onSource: (source: SourceLanguage) => void;
  onTarget: (target: Language) => void;
  onPreview: (artifactId: string) => void;
  onStart: (options: TranslationOptions | null) => void;
};

export function TranslationSettings({
  document,
  source,
  target,
  busy,
  onBack,
  onSource,
  onTarget,
  onPreview,
  onStart,
}: TranslationSettingsProps): JSX.Element {
  const { t, language: displayLanguage } = useTranslation();

  const [advanced, setAdvanced] = useState(false);
  const [domain, setDomain] = useState("");
  const [instructions, setInstructions] = useState("");
  const [glossary, setGlossary] = useState<
    { source: string; target: string }[]
  >([]);

  return (
    <>
      <button className="back-link" data-testid="back-upload" onClick={onBack}>
        <ArrowLeft size={15} />
        {t("Back to upload")}{" "}
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("MAKE IT YOURS")} </div>
          <h1>{t("Translation settings")} </h1>
          <p>{t("Choose your language and translation options.")} </p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <div className="panel-title">
            <span className="stat-icon blue">
              <Languages size={20} />
            </span>
            <div>
              <h2>{t("Language")} </h2>
              <p>{t("Where are we translating to?")} </p>
            </div>
          </div>
          <div className="language-fields">
            <label>
              {t("Source language")}{" "}
              <Select
                data-testid="source-language"
                value={source}
                onValueChange={(value) =>
                  onSource(sourceLanguageSchema.parse(value))
                }
              >
                <SelectOption value="auto">{t("Auto detect")} </SelectOption>
                {languages.map(([code]) => (
                  <SelectOption key={code} value={code}>
                    {localizedLanguageName(displayLanguage, code)}
                  </SelectOption>
                ))}
              </Select>
            </label>
            <ArrowRight size={18} />
            <label>
              {t("Target language")}{" "}
              <Select
                data-testid="target-language"
                value={target}
                onValueChange={(value) => onTarget(languageSchema.parse(value))}
              >
                {languages.map(([code]) => (
                  <SelectOption key={code} value={code}>
                    {localizedLanguageName(displayLanguage, code)}
                  </SelectOption>
                ))}
              </Select>
            </label>
          </div>
          <div className="divider" />
          <h3>{t("Translation mode")} </h3>
          <div
            className="mode-card"
            role="radio"
            aria-checked={!advanced}
            tabIndex={0}
            onClick={() => setAdvanced(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setAdvanced(false);
            }}
          >
            <span className="radio-selected">
              <Check size={12} />
            </span>
            <div>
              <strong>{t("Basic translation")} </strong>
              <p>
                {t(
                  "Standard translation with the original layout preserved.",
                )}{" "}
              </p>
            </div>
            <span className="free-pill">{t("Free")} </span>
          </div>
          <div
            className="mode-card"
            role="radio"
            data-testid="advanced-mode"
            aria-checked={advanced}
            tabIndex={0}
            onClick={() => setAdvanced(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setAdvanced(true);
            }}
          >
            <span className="radio-empty" />
            <div>
              <strong>{t("Advanced (AI)")} </strong>
              <p>{t("Better context understanding, higher accuracy")} </p>
            </div>
            <span className="phase-label">{t("AI")} </span>
          </div>
          {advanced && (
            <fieldset className="advanced-options">
              <legend>{t("Advanced translation · Groq")} </legend>
              <label>
                {t("Domain")}{" "}
                <input
                  data-testid="advanced-domain"
                  value={domain}
                  maxLength={100}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder={t("e.g. machine learning")}
                />
              </label>
              <label className="instructions-field">
                {t("Custom instructions")}{" "}
                <textarea
                  data-testid="advanced-instructions"
                  maxLength={2000}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder={t(
                    "Keep product names in English; use a formal tone…",
                  )}
                />
              </label>
              <GlossaryEditor value={glossary} onChange={setGlossary} />
              <p>
                {t(
                  "Document context and protected numbers, formulas and code are included automatically.",
                )}{" "}
              </p>
            </fieldset>
          )}
          <div className="info-note">
            <ShieldCheck size={17} />
            <p>
              {t(
                "Your original PDF is never overwritten. A new translated PDF will be saved in your library.",
              )}{" "}
            </p>
          </div>
          <div className="settings-actions">
            <span>
              <LockKeyhole size={14} />
              {t("Private & secure")}{" "}
            </span>
            <button
              className="button primary"
              data-testid="start-translation"
              disabled={
                busy ||
                source === target ||
                (advanced &&
                  glossary.some(
                    (term) => !term.source.trim() || !term.target.trim(),
                  ))
              }
              onClick={() =>
                onStart(
                  advanced
                    ? {
                        source_language: source,
                        target_language: target,
                        domain,
                        custom_instructions: instructions,
                        glossary,
                      }
                    : null,
                )
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Sparkles size={16} />
              )}
              {t("Start translation")} <ArrowRight size={16} />
            </button>
          </div>
        </section>
        <aside className="settings-summary">
          <div className="panel">
            <span className="eyebrow">{t("YOUR DOCUMENT")} </span>
            <div className="document-summary">
              <span className="pdf-icon">
                <FileText size={27} />
                <small>{t("PDF")} </small>
              </span>
              <strong>{document.filename}</strong>
              <p>
                {document.page_count} {t("pages ·")}{" "}
                {(document.size / 1024 / 1024).toFixed(2)} {t("MB")}{" "}
              </p>
              <button
                className="text-button"
                data-testid="preview-source"
                onClick={() => onPreview(document.artifact_id)}
              >
                {t("Preview original")} <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <div className="panel limits-panel">
            <h3>{t("You're good to go")} </h3>
            <p>
              <Check size={15} />
              {document.page_count} {t("of 30 pages per file")}{" "}
            </p>
            <p>
              <Check size={15} />
              {t("Basic translation included")}{" "}
            </p>
            <p>
              <Check size={15} />
              {t("Available for 7 days")}{" "}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
