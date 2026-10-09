import {
  createContext,
  useContext,
  useEffect,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { z } from "zod";
import messages from "./locales/messages.json";

const languageSchema = z.enum(["en", "vi", "zh", "ja", "ko", "ru"]);
export type Language = z.infer<typeof languageSchema>;
export type LanguagePreference = Language | "auto";
const preferenceSchema = z.union([languageSchema, z.literal("auto")]);
const storageKey = "transler.display-language";
const timezoneLanguages: Readonly<Record<string, Language>> = {
  "Asia/Shanghai": "zh",
  "Asia/Urumqi": "zh",
  "Asia/Tokyo": "ja",
  "Asia/Seoul": "ko",
  "Europe/Kaliningrad": "ru",
  "Europe/Moscow": "ru",
  "Europe/Kirov": "ru",
  "Europe/Volgograd": "ru",
  "Europe/Astrakhan": "ru",
  "Europe/Saratov": "ru",
  "Europe/Ulyanovsk": "ru",
  "Europe/Samara": "ru",
  "Asia/Yekaterinburg": "ru",
  "Asia/Omsk": "ru",
  "Asia/Novosibirsk": "ru",
  "Asia/Barnaul": "ru",
  "Asia/Tomsk": "ru",
  "Asia/Novokuznetsk": "ru",
  "Asia/Krasnoyarsk": "ru",
  "Asia/Irkutsk": "ru",
  "Asia/Chita": "ru",
  "Asia/Yakutsk": "ru",
  "Asia/Khandyga": "ru",
  "Asia/Vladivostok": "ru",
  "Asia/Ust-Nera": "ru",
  "Asia/Magadan": "ru",
  "Asia/Sakhalin": "ru",
  "Asia/Srednekolymsk": "ru",
  "Asia/Kamchatka": "ru",
  "Asia/Anadyr": "ru",
  "Asia/Ho_Chi_Minh": "vi",
  "Asia/Saigon": "vi",
  "Asia/Chongqing": "zh",
  "Asia/Hong_Kong": "zh",
  "Asia/Taipei": "zh",
};
function detectedLanguage(): Language {
  const regional =
    timezoneLanguages[Intl.DateTimeFormat().resolvedOptions().timeZone];
  if (regional) return regional;
  for (const locale of navigator.languages) {
    const candidate = languageSchema.safeParse(locale.split("-")[0]);
    if (candidate.success) return candidate.data;
  }
  return "en";
}
const catalogSchema = z.record(
  z.object({
    en: z.string(),
    vi: z.string(),
    zh: z.string(),
    ja: z.string(),
    ko: z.string(),
    ru: z.string(),
  }),
);
const catalog = catalogSchema.parse(messages);
type ContextValue = {
  language: Language;
  preference: LanguagePreference;
  setPreference: (value: LanguagePreference) => void;
  t: (text: string) => string;
};
const LanguageContext = createContext<ContextValue | null>(null);
export function LanguageProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [preference, setPreference] = useState<LanguagePreference>(() => {
    const stored = localStorage.getItem(storageKey);
    return stored === null ? "auto" : preferenceSchema.parse(stored);
  });
  const [automatic, setAutomatic] = useState<Language>(detectedLanguage);
  const language = preference === "auto" ? automatic : preference;
  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem(storageKey, preference);
  }, [language, preference]);
  useEffect(() => {
    function refresh(): void {
      setAutomatic(detectedLanguage());
    }
    function sync(event: StorageEvent): void {
      if (event.key === storageKey)
        setPreference(
          event.newValue === null
            ? "auto"
            : preferenceSchema.parse(event.newValue),
        );
    }
    window.addEventListener("languagechange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("languagechange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", sync);
    };
  }, []);
  function t(text: string): string {
    const entry = catalog[text];
    if (!entry) throw new Error(`Missing display-language message: ${text}`);
    return entry[language];
  }
  return (
    <LanguageContext.Provider
      value={{ language, preference, setPreference, t }}
    >
      {children}
    </LanguageContext.Provider>
  );
}
export function useTranslation(): ContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("Display language requires LanguageProvider.");
  return context;
}

export function localizedLanguageName(
  language: Language,
  code: import("./api").Language,
): string {
  const name = new Intl.DisplayNames([language], {
    type: "language",
    fallback: "none",
  }).of(code);
  if (!name) throw new Error(`Unsupported document language: ${code}`);
  return name;
}
