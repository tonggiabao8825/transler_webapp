import { useState, type JSX } from "react";
import type { AccountApi } from "./account-api";
import { useToolAvailability } from "./ToolAvailability";
import { primaryTools, additionalTools } from "./Tools";
import { toolEnabled, type ToolId } from "./tool-contracts";
import { useTranslation } from "./i18n";

type Props = { api: AccountApi; onSaved: () => Promise<void> };
const tools = [...primaryTools, ...additionalTools];

export function AdminToolsPanel({ api, onSaved }: Props): JSX.Element {
  const { t } = useTranslation();
  const { settings, refresh } = useToolAvailability();
  const [saving, setSaving] = useState<ToolId | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function toggle(id: ToolId): Promise<void> {
    if (!settings)
      throw new Error("Wait for tool settings to load before updating.");
    setSaving(id);
    setError(null);
    try {
      await api.updateTool(id, !toolEnabled(settings, id));
      await refresh();
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(null);
    }
  }
  return (
    <section className="panel admin-tools-panel" data-testid="admin-tools">
      <header>
        <h2>{t("Tool availability")}</h2>
        <p>
          {t(
            "Disabled tools stay visible but cannot be used. Running jobs are not interrupted.",
          )}
        </p>
      </header>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-tools-grid">
        {tools.map((tool) => {
          const enabled = toolEnabled(settings, tool.id);
          return (
            <article className="admin-tool-setting" key={tool.id}>
              <div>
                <strong>{t(tool.title)}</strong>
                <small>{t(tool.subtitle)}</small>
                <span className={enabled ? "enabled" : "disabled"}>
                  {settings
                    ? enabled
                      ? t("Active")
                      : t("Disabled")
                    : t("Loading…")}
                </span>
              </div>
              <button
                className="admin-tool-switch"
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={t(tool.title)}
                data-testid={`admin-tool-${tool.id}`}
                disabled={settings === null || saving !== null}
                onClick={() => void toggle(tool.id)}
              >
                <span />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
