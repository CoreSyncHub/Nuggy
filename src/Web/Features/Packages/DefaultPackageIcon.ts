import { html, type TemplateResult } from "lit";

/**
 * Simplified outline NuGet logo, coloured through currentColor so it follows the
 * theme (white on a dark theme, dark on a light one).
 * Used as the default icon for packages without an embedded one.
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
