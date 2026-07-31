import { html, css, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { container } from "tsyringe";
import { type RestoreStatusDto } from "@Shared/Features/Dtos/RestoreStatusDto";
import { type PackageWriteResultDto } from "@Shared/Features/Dtos/PackageWriteResultDto";
import { TranslationService } from "../../Core/Services/TranslationService";
import { checkIcon, crossIcon, ellipsisIcon, warningIcon } from "./Icons";

/**
 * Bandeau présentation-pure (aucun dispatcher) affiché entre la toolbar et le
 * corps de `package-detail` : statut du dernier `dotnet restore` (polling
 * géré par `PackagesView`) et retour du dernier `PackageWriteResultDto`
 * (`skipped`/`error`). `PackagesView` possède tout l'état (y compris
 * l'auto-masquage après succès) ; ce composant se contente de le rendre.
 */
@customElement("write-status-banner")
export class WriteStatusBanner extends LitElement {
  @property({ attribute: false }) restore?: RestoreStatusDto;
  @property({ attribute: false }) writeResult?: PackageWriteResultDto;

  private i18n!: TranslationService;
  private unsubscribeI18n?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.i18n = container.resolve(TranslationService);
    this.unsubscribeI18n = this.i18n.subscribe(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeI18n?.();
  }

  static styles = css`
    :host {
      display: block;
    }
    .banner {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px 14px;
      font-size: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .row svg {
      flex: none;
    }
    .running {
      color: var(--vscode-descriptionForeground);
    }
    .succeeded {
      color: var(--vscode-charts-green);
    }
    .failed,
    .error {
      color: var(--vscode-charts-red);
    }
    .skipped {
      color: var(--vscode-charts-yellow);
    }
    .clickable {
      cursor: pointer;
    }
    /* Le bandeau est atteignable au clavier : il lui faut un focus visible. */
    .clickable:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    .first-message {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 0 1 auto;
    }
    .more {
      color: var(--vscode-descriptionForeground);
      flex: none;
    }
    .view-logs {
      margin-left: auto;
      flex: none;
      text-decoration: underline;
      color: var(--vscode-textLink-foreground);
    }
  `;

  /** Le détail des erreurs vit dans l'onglet Logs : le bandeau en échec navigue vers le run. */
  /** Entrée/Espace activent le bandeau, comme un vrai bouton. */
  private onKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.onShowLogs();
    }
  }

  private onShowLogs(): void {
    this.dispatchEvent(
      new CustomEvent("show-logs", {
        detail: { runId: this.restore?.runId ?? 0 },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderRestore() {
    if (!this.restore) {
      return nothing;
    }
    switch (this.restore.status) {
      case "Running":
        return html`<div class="row running">
          ${ellipsisIcon(14)} ${this.i18n.t("packages.restore.running")}
        </div>`;
      case "Succeeded":
        return html`<div class="row succeeded">
          ${checkIcon(14)} ${this.i18n.t("packages.restore.succeeded")}
        </div>`;
      case "Failed": {
        const first = this.restore.messages[0];
        const more = this.restore.messages.length - 1;
        return html`<div
          class="row failed clickable"
          role="button"
          tabindex="0"
          @click=${this.onShowLogs}
          @keydown=${this.onKeydown}
        >
          ${crossIcon(14)}
          ${this.i18n.t("packages.restore.failed")}${
            first !== undefined ? html`<span class="first-message"> — ${first}</span>` : nothing
          }
          ${
            more > 0
              ? html`<span class="more"
                  >${this.i18n.t("packages.restore.moreLines", { count: more })}</span
                >`
              : nothing
          }
          <span class="view-logs">${this.i18n.t("packages.restore.viewLogs")}</span>
        </div>`;
      }
      default:
        return nothing;
    }
  }

  private renderWriteResult() {
    if (!this.writeResult) {
      return nothing;
    }
    if (this.writeResult.status === "Error") {
      return html`<div class="row error">
        ${crossIcon(14)}
        ${this.i18n.t("packages.write.error", { message: this.writeResult.error ?? "" })}
      </div>`;
    }
    if (this.writeResult.skipped.length > 0) {
      const reasons = this.writeResult.skipped.map((s) => s.reason).join(", ");
      return html`<div class="row skipped">
        ${warningIcon(14)}
        ${this.i18n.t("packages.write.skipped", { count: this.writeResult.skipped.length })}
        ${reasons}
      </div>`;
    }
    return nothing;
  }

  render() {
    const restore = this.renderRestore();
    const writeResult = this.renderWriteResult();
    if (restore === nothing && writeResult === nothing) {
      return nothing;
    }
    return html`<div class="banner">${restore}${writeResult}</div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "write-status-banner": WriteStatusBanner;
  }
}
