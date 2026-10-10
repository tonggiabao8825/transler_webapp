import {
  Bookmark,
  Check,
  ChevronDown,
  Circle,
  Crop,
  Download,
  Eye,
  FilePenLine,
  HeartHandshake,
  LoaderCircle,
  RotateCcw,
  Share2,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { JSX } from "react";
import { lazy, Suspense } from "react";
import { isActive, type Document, type Job } from "../../shared/api/contracts";
import { localizedLanguageName, useTranslation } from "../../shared/i18n/i18n";
const PDFThumbnail = lazy(async () => ({
  default: (await import("../../shared/pdf/PDFThumbnail")).PDFThumbnail,
}));
type JobPanelProps = {
  job: Job;
  document: Document;
  busy: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onPreview: (id: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  onCrop: () => void;
  onDelete: () => void;
  onSave: () => void;
  onTranslate: () => void;
  onShare: () => void;
};
export function JobPanel({
  job,
  document,
  busy,
  onCancel,
  onRetry,
  onPreview,
  onNew,
  onRefresh,
  onEdit,
  onCrop,
  onDelete,
  onSave,
  onTranslate,
  onShare,
}: JobPanelProps): JSX.Element {
  const { t, language } = useTranslation();

  const completed = job.status === "COMPLETED";
  const active = isActive(job);
  const failed = job.status === "FAILED";
  const elapsed =
    job.started_at && job.finished_at
      ? Math.round(
          (new Date(job.finished_at).getTime() -
            new Date(job.started_at).getTime()) /
            1000,
        )
      : null;
  const steps = [
    {
      label: "Preparing document",
      done: job.progress > 0,
      current: job.progress === 0,
    },
    {
      label: "Extracting text and layout",
      done: job.completed_pages > 0,
      current: job.progress === 0,
    },
    {
      label: "Translating content",
      done: job.completed_pages === job.total_units,
      current: job.progress > 0 && job.progress < 90,
    },
    {
      label: "Rebuilding document",
      done: completed,
      current: job.progress >= 90 && !completed,
    },
    { label: "Finalizing", done: completed, current: false },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {completed
              ? t("Translation completed!")
              : failed
                ? t("Translation needs attention")
                : job.status === "CANCELLED"
                  ? t("Translation cancelled")
                  : t("Translating your document…")}
          </h1>
          <p>
            {completed
              ? t("Your document has been successfully translated.")
              : active
                ? t(
                    "This may take a few minutes. You can leave this page and return from My Documents.",
                  )
                : t("Your original document is safe in your library.")}
          </p>
        </div>
      </div>
      <div
        className={`job-layout ${completed ? "completed-layout" : "processing-layout"}`}
      >
        <section
          className={`panel job-panel ${completed ? "completed-file" : ""}`}
        >
          {completed && job.artifact_id ? (
            <>
              <div className="result-paper">
                <Suspense fallback={<div className="skeleton-page" />}>
                  <PDFThumbnail artifactId={job.artifact_id} />
                </Suspense>
                <span className="result-check">
                  <Check size={28} />
                </span>
              </div>
              <h2>
                {document.filename.replace(/\.pdf$/i, "")} (
                {job.target_language}
                {t(").pdf")}{" "}
              </h2>
              <p>
                {job.total_units} {t("pages ·")}{" "}
                {localizedLanguageName(language, job.target_language)}
              </p>
              <span
                className="status-pill status-completed"
                data-testid="job-status"
              >
                {t("completed")}{" "}
              </span>
              <a
                className="button dark result-download"
                data-testid="download-result"
                href={`/v1/artifacts/${job.artifact_id}/download`}
              >
                <Download size={17} />
                {t("Download PDF")} <ChevronDown size={15} />
              </a>
              <div className="file-actions">
                <button
                  data-testid="preview-result"
                  onClick={() => onPreview(job.artifact_id!)}
                >
                  <Eye size={18} />
                  {t("Preview")}{" "}
                </button>
                <button data-testid="share-result" onClick={onShare}>
                  <Share2 size={18} />
                  {t("Share")}{" "}
                </button>
                <button data-testid="save-result" onClick={onSave}>
                  <Bookmark size={18} />
                  {t("Save to library")}{" "}
                </button>
                <button data-testid="edit-result" onClick={onEdit}>
                  <FilePenLine size={18} />
                  {t("Edit PDF")}{" "}
                </button>
                <button data-testid="crop-result" onClick={onCrop}>
                  <Crop size={18} />
                  {t("Crop & translate")}{" "}
                </button>
                <button data-testid="retranslate-result" onClick={onTranslate}>
                  <RotateCcw size={18} />
                  {t("Translate again")}{" "}
                </button>
              </div>
              <div className="result-footer">
                <button
                  className="text-button"
                  data-testid="preview-raw-result"
                  onClick={() => onPreview(document.artifact_id)}
                >
                  {t("View raw PDF")}{" "}
                </button>
                <button
                  className="text-button danger"
                  data-testid="delete-result"
                  disabled={busy}
                  onClick={onDelete}
                >
                  <Trash2 size={14} />
                  {t("Delete")}{" "}
                </button>
              </div>
              <p className="small-note">
                {t(
                  "Raw and processed files are automatically saved in My Documents.",
                )}{" "}
              </p>
            </>
          ) : (
            <>
              <div className="job-document">
                <img
                  className="file-asset"
                  src="/assets/file-types/pdf.svg"
                  alt="PDF"
                />
                <div>
                  <strong>{document.filename}</strong>
                  <p>
                    {job.total_units} {t("pages ·")}{" "}
                    {localizedLanguageName(language, job.target_language)}
                  </p>
                </div>
                <strong>{job.progress}%</strong>
              </div>
              <span
                className={`status-pill status-${job.status.toLowerCase()}`}
                data-testid="job-status"
              >
                {t(job.status.toLowerCase())}
              </span>
              <div
                className="progress-track"
                role="progressbar"
                aria-label={t("Translation progress")}
                aria-valuenow={job.progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div style={{ width: `${job.progress}%` }} />
              </div>
              <div className="job-steps">
                {steps.map((step) => (
                  <div
                    className={`step ${step.done ? "done" : step.current && active ? "current" : ""}`}
                    key={step.label}
                  >
                    {step.done ? (
                      <span>
                        <Check size={13} />
                      </span>
                    ) : step.current && active ? (
                      <LoaderCircle size={19} className="spin" />
                    ) : (
                      <Circle size={19} />
                    )}
                    <strong>{step.label}</strong>
                    <small>
                      {step.done
                        ? t("Completed")
                        : step.current && active
                          ? `${job.completed_pages}/${job.total_units} pages`
                          : t("Waiting…")}
                    </small>
                  </div>
                ))}
              </div>
              <span className="job-stage" data-testid="job-stage">
                {job.stage}
              </span>
              {job.error && (
                <div className="job-error" role="alert">
                  <TriangleAlert size={18} />
                  <div>
                    <strong>{job.error.code}</strong>
                    <pre>{job.error.message}</pre>
                  </div>
                </div>
              )}
              <div className="job-controls">
                {active && (
                  <button
                    className="button secondary"
                    data-testid="cancel-job"
                    disabled={busy || job.status === "CANCELLING"}
                    onClick={onCancel}
                  >
                    <X size={15} />
                    {job.status === "CANCELLING"
                      ? t("Cancelling…")
                      : t("Cancel translation")}
                  </button>
                )}
                {failed && (
                  <button
                    className="button primary"
                    data-testid="retry-job"
                    disabled={busy}
                    onClick={onRetry}
                  >
                    <RotateCcw size={16} />
                    {t("Retry from checkpoint")}{" "}
                  </button>
                )}
                <button
                  className="text-button"
                  data-testid="refresh-job"
                  disabled={busy}
                  onClick={onRefresh}
                >
                  {t("Refresh status")}{" "}
                </button>
              </div>
            </>
          )}
        </section>
        {completed ? (
          <aside className="job-summary">
            <div className="panel">
              <h3>{t("Translation summary")} </h3>
              <dl>
                {(
                  [
                    [
                      "Source language",
                      job.source_language === "auto"
                        ? t("Auto detect")
                        : localizedLanguageName(language, job.source_language),
                    ],
                    [
                      "Target language",
                      localizedLanguageName(language, job.target_language),
                    ],
                    ["Pages", String(job.total_units)],
                    [
                      "Processing time",
                      elapsed === null
                        ? "—"
                        : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`,
                    ],
                    [
                      "Translation mode",
                      job.kind === "advanced" ? t("Advanced (AI)") : t("Basic"),
                    ],
                    ["Provider", job.provider],
                    ["Status", t(job.status.toLowerCase())],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{t(label)}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {job.quality_report && (
              <div className="panel quality-panel">
                <h3>{t("Quality report")} </h3>
                <p>
                  <Check size={15} />
                  {t("Pages with text")}{" "}
                  <strong>
                    {job.quality_report.pages_with_text}/{job.total_units}
                  </strong>
                </p>
                <p>
                  <Check size={15} />
                  {t("Page dimensions")} <strong>{t("Preserved")} </strong>
                </p>
                <p>
                  <TriangleAlert size={15} />
                  {t("Warnings")}{" "}
                  <strong>
                    {job.quality_report.warnings.length} {t("to review")}{" "}
                  </strong>
                </p>
                {job.quality_report.warnings.map((warning, index) => (
                  <div
                    className="quality-warning"
                    key={`${warning.page}-${index}`}
                  >
                    {t("Page")} {warning.page}: {warning.message}
                  </div>
                ))}
                <small>
                  {t(
                    "Layout checks are heuristic. Semantic accuracy needs human review.",
                  )}{" "}
                </small>
              </div>
            )}
          </aside>
        ) : (
          <aside className="processing-art">
            <p className="handwritten">
              {t("“Almost there…”")} <br />
              {t("Great things")} <br />
              {t("take a little time!")}{" "}
            </p>
            <img
              className="processing-plane"
              src="/assets/decorations/paper-plane.svg"
              alt=""
            />
            <img
              className="job-mascot"
              src="/assets/mascot/reading.svg"
              alt="Transler is reading your document"
            />
          </aside>
        )}
      </div>
      {active && (
        <div className="notification-note">
          <HeartHandshake size={23} />
          <div>
            <strong>{t("We’re working on your document")} </strong>
            <p>
              {t(
                "Progress is saved after each page. Find this job again in My Documents.",
              )}{" "}
            </p>
          </div>
        </div>
      )}
      {completed && (
        <div className="next-translation">
          <strong>{t("Ready for your next document?")} </strong>
          <button
            className="button secondary"
            data-testid="translate-another"
            onClick={onNew}
          >
            {t("Translate another PDF")}{" "}
          </button>
        </div>
      )}
    </>
  );
}
