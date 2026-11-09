import { appMessages } from "./app-messages";
import { commentMessages } from "./comment-messages";
import { serverMessages } from "./server-messages";
import { fieldMessages } from "./field-messages";

export type Locale = "en" | "ru";
export type Values = Record<string, string | number>;
export const languageKey = "bb-github-projects:language";
export const messages: Record<string, string> = { ...serverMessages, ...appMessages, ...commentMessages, ...fieldMessages };
export function normalizeLocale(value: unknown): Locale { return value === "ru" ? "ru" : "en"; }
export function readLocale(storage: Pick<Storage, "getItem"> | undefined): Locale {
  try { return normalizeLocale(storage?.getItem(languageKey)); } catch { return "en"; }
}
export function writeLocale(storage: Pick<Storage, "setItem"> | undefined, locale: Locale): void {
  try { storage?.setItem(languageKey, locale); } catch { /* Language still works for this session. */ }
}
function interpolate(template: string, values: Values): string {
  return template.replace(/\{(\w+)\}/g, (token, name: string) => Object.hasOwn(values, name) ? String(values[name]) : token);
}
/** Russian source strings are stable message IDs; GitHub content never enters this function. */
export function translate(locale: Locale, source: string, values: Values = {}): string {
  return interpolate(locale === "en" ? messages[source] ?? source : source, values);
}
export function formatDate(locale: Locale, value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T12:00:00" : value);
  if (!Number.isFinite(date.getTime())) return typeof value === "string" ? value : "";
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", options ?? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-GB").format(value);
}
export type PluralForms = { one: string; few?: string; many?: string; other: string };
export function plural(locale: Locale, count: number, forms: PluralForms): string {
  const category = new Intl.PluralRules(locale).select(count);
  const form = forms[category as keyof PluralForms] ?? forms.other;
  return translate(locale, form, { count: formatNumber(locale, count) });
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Pattern = { regex: RegExp; target: string; names: string[]; source: string };
const patterns = new Map<Locale, Pattern[]>();
function diagnosticPatterns(locale: Locale) {
  if (!patterns.has(locale)) {
    // Use the final catalog value for duplicate diagnostics so both directions agree.
    const diagnostics = { ...serverMessages, ...fieldMessages,
      "Поиск GitHub недоступен; показаны известные участники.": messages["Поиск GitHub недоступен; показаны известные участники."] };
    patterns.set(locale, Object.keys(diagnostics).map((ru) => {
      const en = messages[ru];
      const source = locale === "en" ? ru : en;
      const target = locale === "en" ? en : ru;
      const names: string[] = [];
      const parts = source.split(/(\{\w+\})/g);
      const pattern = parts.map((part, index) => {
        if (!/^\{\w+\}$/.test(part)) return escapeRegex(part);
        names.push(part.slice(1, -1));
        return index === parts.length - 2 && !parts.at(-1) ? "([^\\n]+)" : "([\\s\\S]+?)";
      }).join("");
      return { source, target, names, regex: new RegExp(pattern) };
    }).filter(({source,target}) => source !== target).sort((a,b) => b.source.length - a.source.length));
  }
  return patterns.get(locale)!;
}
/** Localize plugin diagnostics, preserving raw provider errors and interpolated data. */
export function localizeMessage(locale: Locale, message: string, depth = 0): string {
  if (!message || depth > 12) return message;
  const exact = locale === "en" ? messages[message] : Object.entries(messages).find(([, en]) => en === message)?.[0];
  if (exact) return exact;
  let first: { match: RegExpExecArray; entry: Pattern } | undefined;
  for (const entry of diagnosticPatterns(locale)) {
    const match = entry.regex.exec(message);
    if (match && (!first || match.index < first.match.index || (match.index === first.match.index && match[0].length > first.match[0].length))) first = { match, entry };
  }
  if (!first) return message;
  const { match, entry } = first;
  const values = Object.fromEntries(entry.names.map((name, i) => [name,
    name === "error" ? localizeMessage(locale, match[i + 1], depth + 1) : match[i + 1]]));
  return localizeMessage(locale, message.slice(0, match.index), depth + 1) +
    interpolate(entry.target, values) +
    localizeMessage(locale, message.slice(match.index + match[0].length), depth + 1);
}
