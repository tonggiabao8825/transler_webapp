import { useTranslation } from "./i18n";
import type { JSX } from "react";
import { isActive, type Job, type Document } from "./api";
export function OperationPanel({
  job,
  document,
  onCancel,
  onRetry,
  onLibrary,
  onPreview,
  onEdit,
  onCrop,
  onShare,
  onDelete,
  outputIsPDF,
}: {
  job: Job;
  document: Document;
  onCancel: () => void;
  onRetry: () => void;
  onLibrary: () => void;
  outputIsPDF: boolean;
  onPreview: () => void;
  onEdit: () => void;
  onCrop: () => void;
  onShare: () => void;
  onDelete: () => void;
}): JSX.Element {
  const { t } = useTranslation();

  return (
    <section className="panel settings-panel" data-testid="operation-panel">
      <h1>{job.status === "COMPLETED" ? t("Document ready") : job.stage}</h1>
      <p>
        {document.filename} · {job.kind.replaceAll("_", " ")}
      </p>
      <progress value={job.progress} max={100} />
      <p data-testid="job-status">{t(job.status.toLowerCase())}</p>
      {job.error && (
        <p role="alert">
          {job.error.message} ({job.error.code})
        </p>
      )}
      <div className="settings-actions">
        {isActive(job) && (
          <button
            data-testid="cancel-job"
            className="button secondary"
            onClick={onCancel}
          >
            {t("Cancel")}{" "}
          </button>
        )}
        {job.status === "FAILED" && (
          <button
            data-testid="retry-job"
            className="button secondary"
            onClick={onRetry}
          >
            {t("Retry")}{" "}
          </button>
        )}
        {job.artifact_id && (
          <a
            data-testid="download-result"
            className="button primary"
            href={`/v1/artifacts/${job.artifact_id}/download`}
          >
            {t("Download result")}{" "}
          </a>
        )}
        {job.artifact_id && (
          <div className="file-actions">
            {outputIsPDF && (
              <>
                <button data-testid="preview-result" onClick={onPreview}>
                  {t("Preview")}{" "}
                </button>
                <button data-testid="edit-result" onClick={onEdit}>
                  {t("Edit PDF")}{" "}
                </button>
                <button data-testid="crop-result" onClick={onCrop}>
                  {t("Crop & translate")}{" "}
                </button>
              </>
            )}
            <button data-testid="share-result" onClick={onShare}>
              {t("Share")}{" "}
            </button>
            <button data-testid="delete-result" onClick={onDelete}>
              {t("Delete document")}{" "}
            </button>
            <button data-testid="save-result" onClick={onLibrary}>
              {t("Save to library")}{" "}
            </button>
          </div>
        )}
        <button className="button secondary" onClick={onLibrary}>
          {t("My Documents")}{" "}
        </button>
      </div>
      <p>
        {t(
          "Your raw file and every completed version remain in your private library.",
        )}{" "}
      </p>
    </section>
  );
}
