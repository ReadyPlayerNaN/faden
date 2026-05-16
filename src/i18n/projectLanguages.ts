const PROJECT_LANGUAGE_ENTRIES = [
  ["ar", "Arabic"],
  ["bg", "Bulgarian"],
  ["bn", "Bengali"],
  ["ca", "Catalan"],
  ["cs", "Czech"],
  ["da", "Danish"],
  ["de", "German"],
  ["el", "Greek"],
  ["en", "English"],
  ["es", "Spanish"],
  ["et", "Estonian"],
  ["fa", "Persian"],
  ["fi", "Finnish"],
  ["fr", "French"],
  ["he", "Hebrew"],
  ["hi", "Hindi"],
  ["hr", "Croatian"],
  ["hu", "Hungarian"],
  ["id", "Indonesian"],
  ["it", "Italian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["lt", "Lithuanian"],
  ["lv", "Latvian"],
  ["nl", "Dutch"],
  ["no", "Norwegian"],
  ["pl", "Polish"],
  ["pt", "Portuguese"],
  ["ro", "Romanian"],
  ["ru", "Russian"],
  ["sk", "Slovak"],
  ["sl", "Slovenian"],
  ["sr", "Serbian"],
  ["sv", "Swedish"],
  ["ta", "Tamil"],
  ["th", "Thai"],
  ["tr", "Turkish"],
  ["uk", "Ukrainian"],
  ["ur", "Urdu"],
  ["vi", "Vietnamese"],
  ["zh", "Chinese"],
] as const;

export const PROJECT_LANGUAGE_CODES = PROJECT_LANGUAGE_ENTRIES.map(([code]) => code);

const FALLBACK_LABELS = new Map<string, string>(PROJECT_LANGUAGE_ENTRIES);
const NAME_TO_CODE = new Map<string, string>(
  PROJECT_LANGUAGE_ENTRIES.map(([code, label]) => [label.toLowerCase(), code]),
);

export type ProjectLanguageOption = {
  value: string;
  label: string;
  searchText: string;
};

export const normalizeProjectLanguageCode = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const primary = trimmed.toLowerCase().split(/[-_]/)[0];
  if (PROJECT_LANGUAGE_CODES.includes(primary as (typeof PROJECT_LANGUAGE_CODES)[number])) {
    return primary;
  }
  return NAME_TO_CODE.get(trimmed.toLowerCase()) ?? null;
};

export const getProjectLanguageLabel = (code: string, locale?: string): string => {
  const normalized = normalizeProjectLanguageCode(code) ?? code;
  try {
    const label = new Intl.DisplayNames(locale ? [locale] : undefined, {
      type: "language",
    }).of(normalized);
    if (label) return label;
  } catch {
    // ignore
  }
  return FALLBACK_LABELS.get(normalized) ?? normalized;
};

export const getProjectLanguageOptions = (locale?: string): ProjectLanguageOption[] =>
  PROJECT_LANGUAGE_CODES.map((code) => {
    const fallback = FALLBACK_LABELS.get(code) ?? code;
    const label = getProjectLanguageLabel(code, locale);
    return {
      value: code,
      label,
      searchText: `${label} ${fallback} ${code}`.toLowerCase(),
    };
  }).sort((a, b) => a.label.localeCompare(b.label));
