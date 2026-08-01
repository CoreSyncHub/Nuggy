/**
 * Number and date formatting in the interface language.
 *
 * Formatting used to be pinned to `fr-FR` at every call site: an English-speaking
 * user read French thousands separators. The active language
 * active vient de `TranslationService.getCurrentLanguage()`.
 *
 * An invalid language tag must never break the rendering of the view: `Intl`
 * throws a `RangeError` on a malformed tag, so we fall back on the environment's
 * default formatting.
 */
export function formatCount(value: number | undefined, locale: string): string {
  if (value === undefined) {
    return "";
  }
  try {
    return value.toLocaleString(locale);
  } catch {
    return value.toLocaleString();
  }
}

/** ISO UTC date → local date. Empty string when absent or unparsable. */
export function formatDate(isoUtc: string | undefined, locale: string): string {
  if (!isoUtc) {
    return "";
  }
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  try {
    return date.toLocaleDateString(locale);
  } catch {
    return date.toLocaleDateString();
  }
}
