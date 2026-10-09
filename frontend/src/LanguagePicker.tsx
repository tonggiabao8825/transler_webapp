import { Select, SelectOption } from "./Select";
import type { JSX } from "react";
import { Globe2 } from "lucide-react";
import { z } from "zod";
import { useTranslation } from "./i18n";
const preferenceSchema = z.enum(["auto", "en", "vi", "zh", "ja", "ko", "ru"]);
export function LanguagePicker(): JSX.Element {
  const { t, preference, setPreference } = useTranslation();
  return (
    <label className="language-picker">
      <Globe2 size={16} />
      <Select
        data-testid="display-language"
        aria-label={t("Display language")}
        value={preference}
        onValueChange={(value) => setPreference(preferenceSchema.parse(value))}
      >
        <SelectOption value="auto">{t("Automatic")}</SelectOption>
        <SelectOption value="en">English</SelectOption>
        <SelectOption value="vi">Tiếng Việt</SelectOption>
        <SelectOption value="zh">中文</SelectOption>
        <SelectOption value="ja">日本語</SelectOption>
        <SelectOption value="ko">한국어</SelectOption>
        <SelectOption value="ru">Русский</SelectOption>
      </Select>
    </label>
  );
}
