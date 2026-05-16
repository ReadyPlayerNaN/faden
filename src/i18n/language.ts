import i18n from "./index";
import type { GlobalSettings } from "../ipc/settings";
import { normalizeProjectLanguageCode } from "./projectLanguages";

export const resolveDefinitiveLanguage = (value?: string | null): string =>
  normalizeProjectLanguageCode(value) ?? "en";

export const resolveAppLanguage = (
  settings?: Pick<GlobalSettings, "uiLanguage"> | null,
): string =>
  resolveDefinitiveLanguage(
    settings?.uiLanguage ??
      i18n.resolvedLanguage ??
      i18n.language ??
      (typeof navigator !== "undefined" ? navigator.language : null),
  );
