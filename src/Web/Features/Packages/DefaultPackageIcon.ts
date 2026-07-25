import { html, type TemplateResult } from "lit";

/**
 * Logo NuGet simplifié en trait (outline), colorié via currentColor pour
 * suivre le thème (blanc en thème sombre, foncé en thème clair).
 * Sert d'icône par défaut pour les packages sans icône embarquée.
 */
export function defaultPackageIcon(size: number): TemplateResult {
  return html`<svg
    width=${size}
    height=${size}
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    aria-hidden="true"
    style="vertical-align: -0.125em"
  >
    <rect x="3" y="3" width="26" height="26" rx="6" />
    <circle cx="20" cy="20" r="5.5" />
    <circle cx="10.5" cy="10.5" r="2.5" fill="currentColor" stroke="none" />
  </svg>`;
}
