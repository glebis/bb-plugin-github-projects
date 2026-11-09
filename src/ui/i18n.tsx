import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatDate, formatNumber, languageKey, localizeMessage, normalizeLocale, plural, readLocale, translate, writeLocale, type Locale, type PluralForms, type Values } from "../i18n";

function storage() { try { return globalThis.localStorage; } catch { return undefined; } }
function helpers(locale: Locale, setLocale: (locale: Locale) => void) {
  return {
    locale, setLocale,
    t: (source: string, values?: Values) => translate(locale, source, values),
    localize: (text: string) => localizeMessage(locale, text),
    formatDate: (value: string | Date, options?: Intl.DateTimeFormatOptions) => formatDate(locale, value, options),
    number: (value: number) => formatNumber(locale, value),
    plural: (count: number, forms: PluralForms) => plural(locale, count, forms),
  };
}
const I18nContext = createContext(helpers("en", () => {}));
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLanguage] = useState<Locale>(() => readLocale(storage()));
  const value = useMemo(() => helpers(locale, (next) => {
    const language = normalizeLocale(next);
    writeLocale(storage(), language);
    setLanguage(language);
  }), [locale]);
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === languageKey || event.key === null) setLanguage(readLocale(storage()));
    };
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, []);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export const useI18n = () => useContext(I18nContext);
