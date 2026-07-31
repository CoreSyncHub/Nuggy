export type TranslationDictionary = Record<string, unknown>;
export type TranslationParams = Record<string, string | number>;

/**
 * Résolution d'une clé en notation pointée dans un dictionnaire de traductions.
 * Fonctions pures, sans `fetch` ni `window` : c'est ce qui les rend testables,
 * là où `TranslationService` dépend de l'environnement de la webview.
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
    // hasOwnProperty : sans cette garde, des clés comme « constructor » ou
    // « toString » remonteraient un membre du prototype au lieu d'une traduction.
    if (!Object.prototype.hasOwnProperty.call(value, segment)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  // Un nœud intermédiaire n'est pas une traduction affichable.
  return typeof value === "string" ? value : undefined;
}

/** Substitue les paramètres `{{nom}}` ; un paramètre non fourni reste littéral. */
export function interpolate(text: string, params: TranslationParams): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Traduction avec repli par clé sur l'anglais. Une locale partielle affiche donc
 * de l'anglais là où il lui manque une clé, au lieu du chemin brut — un
 * dictionnaire incomplet ne peut plus faire apparaître « packages.list.loadMore »
 * dans l'interface. La clé elle-même ne subsiste qu'en dernier recours, quand
 * aucun des deux dictionnaires ne la connaît.
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
