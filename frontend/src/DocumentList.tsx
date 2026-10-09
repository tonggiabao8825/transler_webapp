import { localizedLanguageName, useTranslation } from "./i18n";
import type { JSX } from "react";
import {
  ArrowRight,
  Eye,
  Download,
  FilePenLine,
  Crop,
  Star,
  ArchiveRestore,
  Folder,
  Trash2,
} from "lucide-react";
import { isActive, type Document, type Job, type Artifact } from "./api";
export type DocumentListProps = {
  documents: Document[];
  jobs: Job[];
  artifacts: Artifact[];
  onFavorite: (document: Document) => void;
  onTrash: (document: Document) => void;
  onTranslate: (document: Document) => void;
  onJob: (job: Job) => void;
  onPreview: (artifactId: string) => void;
  onEdit: (document: Document, artifactId: string) => void;
  onCrop: (document: Document, artifactId: string) => void;
  onDelete: (id: string) => void;
};
export function DocumentList({
  documents,
  jobs,
  artifacts,
  onFavorite,
  onTrash,
  onTranslate,
  onJob,
  onPreview,
  onEdit,
  onCrop,
  onDelete,
}: DocumentListProps): JSX.Element {
  const { t, language } = useTranslation();

  if (!documents.length)
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <Folder size={28} />
        </span>
        <h3>{t("Your documents will appear here")} </h3>
        <p>
          {t(
            "Upload a PDF to keep its raw file and processed versions together.",
          )}{" "}
        </p>
      </div>
    );
  return (
    <div className="document-list">
      {documents.map((document) => {
        const history = jobs.filter((item) => item.document_id === document.id);
        const completed = history.filter(
          (item) => item.status === "COMPLETED" && item.artifact_id !== null,
        );
        const active = history.some(isActive);
        return (
          <article
            className="document-row"
            key={document.id}
            data-testid={`document-${document.id}`}
          >
            <div className="document-cell">
              <img
                className="file-asset"
                src="/assets/file-types/pdf.svg"
                alt="PDF"
              />
              <div>
                <strong>{document.filename}</strong>
                <small>
                  {document.page_count} {t("pages ·")}{" "}
                  {(document.size / 1024 / 1024).toFixed(2)} {t("MB ·")}{" "}
                  {new Date(document.created_at).toLocaleDateString(language)}
                </small>
              </div>
            </div>
            <div className="row-actions">
              <button
                className="icon-button"
                data-testid={`favorite-${document.id}`}
                aria-label={t("Toggle favorite")}
                aria-pressed={document.favorite}
                onClick={() => onFavorite(document)}
              >
                <Star
                  size={16}
                  fill={document.favorite ? "currentColor" : "none"}
                />
              </button>
              <button
                className="icon-button"
                data-testid={`trash-${document.id}`}
                aria-label={
                  document.deleted_at
                    ? t("Restore document")
                    : t("Move to Trash")
                }
                disabled={active}
                onClick={() => onTrash(document)}
              >
                <ArchiveRestore size={16} />
              </button>
              <button
                data-testid={`translate-${document.id}`}
                className="text-button"
                disabled={document.deleted_at !== null}
                onClick={() => onTranslate(document)}
              >
                {t("Translate")} <ArrowRight size={14} />
              </button>
              <button
                data-testid={`delete-${document.id}`}
                className="icon-button danger"
                aria-label={`Delete ${document.filename} and all versions`}
                disabled={active}
                onClick={() => onDelete(document.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="document-versions">
              <div className="version-row" data-testid={`raw-${document.id}`}>
                <span className="version-kind raw">{t("Raw")} </span>
                <span className="version-description">
                  {t("Original")} {document.source_format.toUpperCase()}{" "}
                  <small>{t("Unmodified source")} </small>
                </span>
                <button
                  data-testid={`preview-${document.id}`}
                  className="icon-button"
                  disabled={document.source_format !== "pdf"}
                  aria-label={t("Preview raw PDF")}
                  onClick={() => onPreview(document.artifact_id)}
                >
                  <Eye size={15} />
                </button>
                <a
                  data-testid={`download-raw-${document.id}`}
                  className="icon-button"
                  aria-label={t("Download raw PDF")}
                  href={`/v1/artifacts/${document.artifact_id}/download`}
                >
                  <Download size={15} />
                </a>
              </div>
              {completed.map((item) => (
                <div
                  className="version-row"
                  key={item.id}
                  data-testid={`processed-${item.id}`}
                >
                  <span className="version-kind processed">
                    {t("Processed")}{" "}
                  </span>
                  <button
                    data-testid={`open-job-${item.id}`}
                    className="version-description"
                    onClick={() => onJob(item)}
                  >
                    {artifacts.find((file) => file.id === item.artifact_id)
                      ?.filename ?? item.kind}
                    <small>
                      {new Date(
                        item.finished_at ?? item.created_at,
                      ).toLocaleString(language)}
                    </small>
                  </button>
                  <button
                    className="icon-button"
                    data-testid={`preview-processed-${item.id}`}
                    disabled={
                      artifacts.find((file) => file.id === item.artifact_id)
                        ?.mime_type !== "application/pdf"
                    }
                    aria-label={t("Preview processed PDF")}
                    onClick={() => onPreview(item.artifact_id!)}
                  >
                    <Eye size={15} />
                  </button>
                  <a
                    className="icon-button"
                    data-testid={`download-processed-${item.id}`}
                    aria-label={t("Download processed PDF")}
                    href={`/v1/artifacts/${item.artifact_id}/download`}
                  >
                    <Download size={15} />
                  </a>
                  {document.deleted_at === null && (
                    <>
                      <button
                        className="icon-button"
                        data-testid={`edit-processed-${item.id}`}
                        disabled={
                          artifacts.find((file) => file.id === item.artifact_id)
                            ?.mime_type !== "application/pdf"
                        }
                        aria-label={t("Edit processed PDF")}
                        onClick={() => onEdit(document, item.artifact_id!)}
                      >
                        <FilePenLine size={15} />
                      </button>
                      <button
                        className="icon-button"
                        data-testid={`crop-processed-${item.id}`}
                        disabled={
                          artifacts.find((file) => file.id === item.artifact_id)
                            ?.mime_type !== "application/pdf"
                        }
                        aria-label={t("Crop and retranslate")}
                        onClick={() => onCrop(document, item.artifact_id!)}
                      >
                        <Crop size={15} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {history
              .filter((item) => item.status !== "COMPLETED")
              .map((item) => (
                <button
                  key={item.id}
                  className="history-job"
                  data-testid={`history-job-${item.id}`}
                  onClick={() => onJob(item)}
                >
                  <span>
                    {localizedLanguageName(language, item.target_language)}
                  </span>
                  <span
                    className={`status-pill status-${item.status.toLowerCase()}`}
                  >
                    {t(item.status.toLowerCase())}
                  </span>
                  <small>
                    {item.completed_pages}/{document.page_count}{" "}
                    {t("pages")}{" "}
                  </small>
                </button>
              ))}
          </article>
        );
      })}
    </div>
  );
}
