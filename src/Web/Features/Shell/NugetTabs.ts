import { html, css, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { container } from "tsyringe";
import { TranslationService } from "../../Core/Services/TranslationService";
import "../Packages/PackagesView";
import "../Logs/LogsView";

type TabId = "packages" | "logs";

const TAB_ORDER: TabId[] = ["packages", "logs"];

/**
 * Coquille à onglets de la webview : Packages (défaut) / Logs.
 *
 * Onglets natifs plutôt que `fluent-tabs` : les composants Fluent portent leur
 * propre design system (palette neutre claire par défaut, d'où un libellé noir
 * illisible sur thème sombre) et interposent un shadow DOM dont le wrapper
 * interne ne propage pas la hauteur — les vues slottées ne pouvaient donc plus
 * défiler. Ici tout est stylé aux tokens `--vscode-*`, comme le reste de l'UI.
 *
 * Les deux panneaux restent montés en permanence : l'inactif est simplement
 * masqué, donc l'état de packages-view (sélection, largeur du splitter,
 * polling restore) survit aux changements d'onglet.
 *
 * Navigation croisée : le bandeau d'échec de restore (dans packages-view)
 * émet `show-logs { runId }` (bubbles + composed) → activation de l'onglet
 * Logs + ciblage du run. `restore-finished` (émis par packages-view quand son
 * polling observe un état terminal) → rafraîchissement de logs-view si actif.
 */
@customElement("nuget-tabs")
export class NugetTabs extends LitElement {
  @state() private activeId: TabId = "packages";
  /** Incrémenté à chaque fin de restore observée : logs-view re-fetch si actif. */
  @state() private refreshToken = 0;
  /** runId à cibler dans logs-view à la prochaine activation (consommé puis remis à undefined). */
  @state() private targetRunId?: number;

  private i18n!: TranslationService;
  private unsubscribeI18n?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.i18n = container.resolve(TranslationService);
    this.unsubscribeI18n = this.i18n.subscribe(() => this.requestUpdate());
    this.addEventListener("show-logs", this.onShowLogs as EventListener);
    this.addEventListener("restore-finished", this.onRestoreFinished);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeI18n?.();
    this.removeEventListener("show-logs", this.onShowLogs as EventListener);
    this.removeEventListener("restore-finished", this.onRestoreFinished);
  }

  static styles = css`
    :host {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      width: 100%;
      overflow: hidden;
    }
    .tabbar {
      display: flex;
      flex: none;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .tab {
      appearance: none;
      background: transparent;
      border: none;
      border-bottom: 1px solid transparent;
      margin-bottom: -1px;
      padding: 6px 14px;
      font-family: inherit;
      font-size: 12px;
      color: var(--vscode-panelTitle-inactiveForeground, var(--vscode-descriptionForeground));
      cursor: pointer;
    }
    .tab:hover {
      color: var(--vscode-panelTitle-activeForeground, var(--vscode-foreground));
      background: var(--vscode-list-hoverBackground);
    }
    .tab[aria-selected="true"] {
      color: var(--vscode-panelTitle-activeForeground, var(--vscode-foreground));
      border-bottom-color: var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder));
    }
    .tab:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    .panels {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }
    .panel {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    /* Règle d'auteur nécessaire : .panel { display: flex } l'emporterait sinon
       sur le display:none que la feuille de style du navigateur associe à [hidden]. */
    .panel[hidden] {
      display: none;
    }
  `;

  private onShowLogs = (e: CustomEvent<{ runId: number }>): void => {
    this.targetRunId = e.detail.runId;
    this.activeId = "logs";
  };

  private onRestoreFinished = (): void => {
    this.refreshToken++;
  };

  private select(id: TabId): void {
    this.activeId = id;
    // Le ciblage d'un run n'a de sens que pour l'activation qui l'a demandé :
    // revenir sur Packages l'annule, sinon un futur retour sur Logs redéplierait
    // et re-scrollerait un run que l'utilisateur a déjà consulté.
    if (id === "packages") {
      this.targetRunId = undefined;
    }
  }

  /** Navigation clavier du motif ARIA « tabs » : flèches, Origine, Fin. */
  private onKeydown(e: KeyboardEvent): void {
    const current = TAB_ORDER.indexOf(this.activeId);
    let next: number | undefined;
    switch (e.key) {
      case "ArrowRight":
        next = (current + 1) % TAB_ORDER.length;
        break;
      case "ArrowLeft":
        next = (current - 1 + TAB_ORDER.length) % TAB_ORDER.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = TAB_ORDER.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    this.select(TAB_ORDER[next]);
    void this.updateComplete.then(() => {
      this.shadowRoot?.querySelector<HTMLButtonElement>(`#tab-${this.activeId}`)?.focus();
    });
  }

  private renderTab(id: TabId, label: string) {
    const selected = this.activeId === id;
    return html`<button
      id="tab-${id}"
      class="tab"
      role="tab"
      type="button"
      aria-selected=${selected}
      aria-controls="panel-${id}"
      tabindex=${selected ? 0 : -1}
      @click=${() => this.select(id)}
    >
      ${label}
    </button>`;
  }

  render() {
    return html`
      <div class="tabbar" role="tablist" @keydown=${this.onKeydown}>
        ${this.renderTab("packages", this.i18n.t("tabs.packages"))}
        ${this.renderTab("logs", this.i18n.t("tabs.logs"))}
      </div>
      <div class="panels">
        <div
          id="panel-packages"
          class="panel"
          role="tabpanel"
          aria-labelledby="tab-packages"
          ?hidden=${this.activeId !== "packages"}
        >
          <packages-view></packages-view>
        </div>
        <div
          id="panel-logs"
          class="panel"
          role="tabpanel"
          aria-labelledby="tab-logs"
          ?hidden=${this.activeId !== "logs"}
        >
          <logs-view
            .active=${this.activeId === "logs"}
            .refreshToken=${this.refreshToken}
            .targetRunId=${this.targetRunId}
          ></logs-view>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "nuget-tabs": NugetTabs;
  }
}
