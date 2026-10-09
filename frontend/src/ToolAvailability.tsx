import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { AccountApi } from "./account-api";
import type { ToolSetting } from "./tool-contracts";
import { useTranslation } from "./i18n";

type Availability = {
  settings: ToolSetting[] | null;
  refresh: () => Promise<void>;
};
const ToolContext = createContext<Availability | null>(null);

export function ToolAvailability({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const { t } = useTranslation();
  const [api] = useState(() => new AccountApi());
  const [settings, setSettings] = useState<ToolSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    const next = await api.tools();
    setSettings(next);
    setError(null);
  }, [api]);
  useEffect(() => {
    const reload = (): void => {
      void refresh().catch((failure: Error) => {
        setSettings(null);
        setError(failure.message);
      });
    };
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [refresh]);
  return (
    <ToolContext.Provider value={{ settings, refresh }}>
      {error && (
        <div className="tool-availability-error" role="alert">
          {error}
          <button
            className="button secondary"
            onClick={() =>
              void refresh().catch((failure: Error) =>
                setError(failure.message),
              )
            }
          >
            {t("Retry")}
          </button>
        </div>
      )}
      {children}
    </ToolContext.Provider>
  );
}

export function useToolAvailability(): Availability {
  const context = useContext(ToolContext);
  if (!context) throw new Error("Tool availability provider is missing.");
  return context;
}
