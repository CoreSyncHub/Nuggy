export type TranslationDictionary = Record<string, unknown>;
export type TranslationParams = Record<string, string | number>;

/**
 * Resolution of a dot-notation key inside a translation dictionary.
 * Pure functions, no `fetch` and no `window`: that is what makes them testable,
 * where `TranslationService` depends on the webview environment.
 */
export function lookupTranslation(
  dictionary: TranslationDictionary,
  key: string,
): string | undefined {
  let value: unknown = dictionary;
  for (const segment of key.split(".")) {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    // hasOwnProperty: without this guard, keys such as "constructor" or
    // "toString" would surface a prototype member instead of a translation.
    if (!Object.prototype.hasOwnProperty.call(value, segment)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  // An intermediate node is not a displayable translation.
  return typeof value === "string" ? value : undefined;
}

/** Substitutes `{{name}}` parameters; a parameter that is not supplied stays literal. */
export function interpolate(text: string, params: TranslationParams): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Translation with a per-key fallback to English. A partial locale therefore
 * displays English wherever a key is missing, instead of the raw path — an
 * incomplete dictionary can no longer surface "packages.list.loadMore" in the
 * interface. The key itself survives only as a last resort, when neither
 * dictionary knows it.
 */
export function translate(
  primary: TranslationDictionary,
  fallback: TranslationDictionary,
  key: string,
  params?: TranslationParams,
): string {
  const value = lookupTranslation(primary, key) ?? lookupTranslation(fallback, key);
  if (value === undefined) {
    return key;
  }
  return params ? interpolate(value, params) : value;
}
