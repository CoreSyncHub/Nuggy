import { css } from "lit";

/**
 * Hover tint of the three write actions, shared by the global toolbar
 * (`package-detail`) and the project cards (`project-installations`):
 * green to install, blue to update, red to uninstall. Each of these components
 * has its own shadow root, hence a shared stylesheet rather than a rule copied
 * on both sides.
 *
 * The background is a 22 % mix of the colour over the theme surface — hence dark
 * on a dark theme — while the icon switches to the full, brighter colour: SVG
 * paths inherit `currentColor`. A disabled button never reacts, otherwise the UI
 * would suggest an action the Host refuses (legacy project, centrally managed
 * package, write already in flight).
 */
export const writeActionStyles = css`
  button.install,
  button.upgrade,
  button.uninstall {
    transition:
      background 0.12s,
      border-color 0.12s,
      color 0.12s;
  }
  button.install:not(:disabled):hover,
  button.install:not(:disabled):focus-visible {
    background: color-mix(in srgb, var(--vscode-charts-green) 22%, transparent);
    border-color: color-mix(in srgb, var(--vscode-charts-green) 55%, transparent);
    color: var(--vscode-charts-green);
  }
  button.upgrade:not(:disabled):hover,
  button.upgrade:not(:disabled):focus-visible {
    background: color-mix(in srgb, var(--vscode-charts-blue) 22%, transparent);
    border-color: color-mix(in srgb, var(--vscode-charts-blue) 55%, transparent);
    color: var(--vscode-charts-blue);
  }
  button.uninstall:not(:disabled):hover,
  button.uninstall:not(:disabled):focus-visible {
    background: color-mix(in srgb, var(--vscode-charts-red) 22%, transparent);
    border-color: color-mix(in srgb, var(--vscode-charts-red) 55%, transparent);
    color: var(--vscode-charts-red);
  }
`;
