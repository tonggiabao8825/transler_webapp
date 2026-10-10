import { FileText, Link2, ShieldCheck, X } from "lucide-react";
import { useEffect, useState, type JSX } from "react";
import { z } from "zod";
import { readResponse } from "../../shared/api/http";
import { useTranslation } from "../../shared/i18n/i18n";
const shareSchema = z.object({
  id: z.string().uuid(),
  artifact_id: z.string().uuid(),
  filename: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
});
export async function createShare(artifactId: string): Promise<string> {
  const result = await readResponse(
    await fetch("/v1/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifact_id: artifactId,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      }),
    }),
    z.object({ share: shareSchema, url: z.string().url() }),
  );
  return result.url;
}
export function SharedFiles(): JSX.Element {
  const { t, language } = useTranslation();

  const [shares, setShares] = useState<z.infer<typeof shareSchema>[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/v1/shares", { signal: controller.signal })
      .then((response) => readResponse(response, z.array(shareSchema)))
      .then((next) => {
        setShares(next);
        setLoading(false);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) {
          setError(failure.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);
  async function revoke(id: string): Promise<void> {
    setRevoking(id);
    setError(null);
    try {
      const response = await fetch(`/v1/shares/${id}`, { method: "DELETE" });
      if (!response.ok) await readResponse(response, z.never());
      setShares((current) => current.filter((share) => share.id !== id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRevoking(null);
    }
  }
  return (
    <section className="shared-screen" data-testid="shared-screen">
      <div className="page-heading">
        <div>
          <h1>{t("Shared files")} </h1>
          <p>{t("Manage access to the versions you share.")} </p>
        </div>
      </div>
      <div className="collection-notice">
        <ShieldCheck size={18} />
        <p>
          {t(
            "Anyone with a share link can download that version until it expires or you revoke it.",
          )}{" "}
        </p>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">{t("Loading shared files…")} </p>
      ) : (
        <div className="shared-list">
          {shares.map((share) => (
            <article className="shared-file-card" key={share.id}>
              <span className="shared-file-icon">
                <FileText size={24} />
              </span>
              <div className="shared-file-details">
                <strong>{share.filename}</strong>
                <p>
                  {t("Expires")}{" "}
                  {new Date(share.expires_at).toLocaleString(language)}
                </p>
                <small>
                  {t("Created")}{" "}
                  {new Date(share.created_at).toLocaleDateString(language)}
                </small>
              </div>
              <span
                className={`share-status ${new Date(share.expires_at).getTime() <= Date.now() ? "expired" : "active"}`}
              >
                {new Date(share.expires_at).getTime() <= Date.now()
                  ? t("Expired")
                  : t("Active link")}
              </span>
              <button
                className="button secondary"
                data-testid={`revoke-share-${share.id}`}
                disabled={revoking !== null}
                onClick={() => void revoke(share.id)}
              >
                <X size={15} />
                {t("Revoke link")}{" "}
              </button>
            </article>
          ))}
          {!error && !shares.length && (
            <div className="collection-empty">
              <span>
                <Link2 size={30} />
              </span>
              <h2>{t("No shared documents")} </h2>
              <p>
                {t(
                  "Create a link from a completed translation. You can manage it here.",
                )}{" "}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
