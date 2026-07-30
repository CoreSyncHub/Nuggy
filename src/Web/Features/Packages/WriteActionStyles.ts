import { css } from "lit";

/**
 * Teinte de survol des trois actions d'écriture, partagée par la toolbar
 * globale (`package-detail`) et les cartes projet (`project-installations`) :
 * vert pour installer, bleu pour mettre à jour, rouge pour désinstaller. Ces
 * composants ont chacun leur shadow root, d'où une feuille commune plutôt
 * qu'une règle recopiée des deux côtés.
 *
 * Le fond est un mélange à 22 % de la couleur sur la surface du thème — donc
 * foncé en thème sombre — tandis que l'icône passe à la couleur pleine, plus
 * claire : les tracés SVG héritent de `currentColor`. Un bouton désactivé ne
 * réagit jamais, sans quoi l'UI suggérerait une action que le Host refuse
 * (projet legacy, package géré centralement, écriture déjà en cours).
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
