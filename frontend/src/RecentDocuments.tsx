import { useTranslation } from "./i18n";
import type { JSX } from "react";
import { Folder } from "lucide-react";
import { isActive, type Document, type Job } from "./api";
type RecentDocumentsProps = {
  documents: Document[];
  jobs: Job[];
  onDocument: (document: Document) => void;
  onJob: (job: Job) => void;
};
export function RecentDocuments({
  documents,
  jobs,
  onDocument,
  onJob,
}: RecentDocumentsProps): JSX.Element {
  const { t, language } = useTranslation();

  if (!documents.length)
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <Folder size={27} />
        </span>
        <h3>{t("Your workspace is ready")} </h3>
        <p>{t("Upload your first PDF to see it here.")} </p>
      </div>
    );
  return (
    <div className="recent-documents">
      {documents.slice(0, 4).map((document) => {
        const job = jobs.find((item) => item.document_id === document.id);
        return (
          <button
            className="recent-document"
            key={document.id}
            data-testid={`recent-${document.id}`}
            onClick={() => (job ? onJob(job) : onDocument(document))}
          >
            <img
              className="file-asset"
              src="/assets/file-types/pdf.svg"
              alt="PDF"
            />
            <span>
              <strong>{document.filename}</strong>
              <small>
                {job
                  ? isActive(job)
                    ? t("Processing")
                    : job.status === "COMPLETED"
                      ? t("Translated · Raw + Processed")
                      : t(job.status.toLowerCase())
                  : t("Raw PDF")}{" "}
                · {document.page_count} {t("pages")}{" "}
              </small>
            </span>
            <span className="recent-date">
              {new Date(document.created_at).toLocaleDateString(language)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
