import { html, css, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { container } from "tsyringe";
import { TranslationService } from "../../Core/Services/TranslationService";
import "../Packages/PackagesView";
import "../Logs/LogsView";

type TabId = "packages" | "logs";

const TAB_ORDER: TabId[] = ["packages", "logs"];

/**
 * Tabbed shell of the webview: Packages (default) / Logs.
 *
 * Native tabs rather than `fluent-tabs`: the Fluent components carry their own
 * design system (a light neutral palette by default, hence a black label
 * unreadable on a dark theme) and interpose a shadow DOM whose inner wrapper
 * does not propagate height — so the slotted views could no longer scroll. Here
 * everything is styled with `--vscode-*` tokens, like the rest of the UI.
 *
 * Both panels stay mounted at all times: the inactive one is merely hidden, so
 * the state of packages-view (selection, splitter width, restore polling)
 * survives tab changes.
 *
 * Cross navigation: the restore failure banner (inside packages-view) emits
 * `show-logs { runId }` (bubbles + composed) → activates the Logs tab and
 * targets the run. `restore-finished` (emitted by packages-view when its polling
 * observes a terminal state) → refreshes logs-view when it is active.
 */
@customElement("nuget-tabs")
export class NugetTabs extends LitElement {
  @state() private activeId: TabId = "packages";
  /** Incremented on every observed restore completion: logs-view re-fetches when active. */
  @state() private refreshToken = 0;
  /** runId to target in logs-view on the next activation (consumed then reset to undefined). */
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
    /* Author rule required: .panel { display: flex } would otherwise win over
       the display:none the browser stylesheet attaches to [hidden]. */
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
    // Targeting a run only makes sense for the activation that asked for it:
    // going back to Packages cancels it, otherwise a later return to Logs would
    // re-expand and re-scroll a run the user has already looked at.
    if (id === "packages") {
      this.targetRunId = undefined;
    }
  }

  /** Keyboard navigation of the ARIA "tabs" pattern: arrows, Home, End. */
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
