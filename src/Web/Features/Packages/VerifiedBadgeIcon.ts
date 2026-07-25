import { html, type TemplateResult } from "lit";

/**
 * Coche de vérification festonnée (style nuget.org). La couleur du disque
 * distingue l'éditeur vérifié (bleu) du package officiel Microsoft (violet
 * .NET) — un package Microsoft étant nécessairement vérifié, on n'affiche
 * jamais les deux badges.
 */
export function verifiedBadgeIcon(fill: string, size: number, title: string): TemplateResult {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" role="img" aria-label=${title}>
    <title>${title}</title>
    <path
      fill=${fill}
      d="M21.187 10.007a3.5 3.5 0 0 1-.864-.712 3.4 3.4 0 0 1 .277-1.141c.291-.821.62-1.751.092-2.474s-1.525-.7-2.4-.68a3.4 3.4 0 0 1-1.155-.078 3.4 3.4 0 0 1-.425-1.063c-.248-.845-.531-1.8-1.4-2.086-.838-.27-1.614.324-2.3.846A3.3 3.3 0 0 1 12 3.25a3.3 3.3 0 0 1-1.023-.631C10.293 2.1 9.52 1.5 8.678 1.774c-.867.282-1.15 1.24-1.4 2.085a3.4 3.4 0 0 1-.421 1.061A3.5 3.5 0 0 1 5.7 5c-.878-.024-1.867-.05-2.4.68s-.2 1.653.092 2.473a3.3 3.3 0 0 1 .281 1.141 3.5 3.5 0 0 1-.863.713c-.732.5-1.563 1.069-1.563 1.993s.831 1.491 1.563 1.993a3.5 3.5 0 0 1 .863.712 3.3 3.3 0 0 1-.273 1.142c-.29.82-.618 1.75-.091 2.473s1.521.7 2.4.68a3.4 3.4 0 0 1 1.156.078 3.4 3.4 0 0 1 .424 1.063c.248.845.531 1.8 1.4 2.086a1.4 1.4 0 0 0 .431.068 3.4 3.4 0 0 0 1.868-.914A3.3 3.3 0 0 1 12 20.75a3.3 3.3 0 0 1 1.023.631c.685.523 1.461 1.12 2.3.845.867-.282 1.15-1.24 1.4-2.084a3.4 3.4 0 0 1 .424-1.062A3.4 3.4 0 0 1 18.3 19c.878.021 1.867.05 2.4-.68s.2-1.653-.092-2.474a3.4 3.4 0 0 1-.281-1.139 3.4 3.4 0 0 1 .864-.713c.732-.5 1.563-1.07 1.563-1.994s-.834-1.492-1.567-1.993"
    />
    <path
      fill="#ffffff"
      d="M11 14.75a.75.75 0 0 1-.53-.22l-2-2a.75.75 0 0 1 1.06-1.06l1.54 1.54 3.48-2.61a.75.75 0 0 1 .9 1.2l-4 3a.75.75 0 0 1-.45.15"
    />
  </svg>`;
}

export const VERIFIED_BLUE = "#49adf4";
export const MICROSOFT_PURPLE = "#512BD4";
