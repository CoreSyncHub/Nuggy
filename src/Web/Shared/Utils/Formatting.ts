/**
 * Formatage des nombres et des dates dans la langue de l'interface.
 *
 * Le formatage était auparavant figé en `fr-FR` à chaque point d'appel : un
 * utilisateur anglophone lisait des séparateurs de milliers français. La langue
 * active vient de `TranslationService.getCurrentLanguage()`.
 *
 * Une étiquette de langue invalide ne doit jamais casser le rendu de la vue :
 * `Intl` jette un `RangeError` sur une étiquette malformée, on retombe alors
 * sur le formatage par défaut de l'environnement.
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

/** Date ISO UTC → date locale. Chaîne vide si absente ou non analysable. */
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
