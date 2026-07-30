import { html, css, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { container } from "tsyringe";
import { type SolutionPackageDto } from "@Shared/Features/Dtos/SolutionPackagesDto";
import { type PackageUpdateState } from "@Shared/Features/Packages/PackageUpdateState";
import { TranslationService } from "../../Core/Services/TranslationService";
import { defaultPackageIcon } from "./DefaultPackageIcon";
import { arrowUpIcon, checkIcon, ellipsisIcon, helpIcon } from "./Icons";

@customElement("package-list-item")
export class PackageListItem extends LitElement {
  @property({ attribute: false }) package!: SolutionPackageDto;
  /** `loading` tant que les métadonnées nuget.org du package n'ont pas répondu. */
  @property() badge: PackageUpdateState | "loading" = "loading";
  @property({ type: Boolean }) selected = false;

  @state() private iconFailed = false;

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
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      cursor: pointer;
      border-radius: 4px;
      color: var(--vscode-foreground);
    }
    .row:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .row.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    img.icon {
      width: 16px;
      height: 16px;
      flex: none;
    }
    svg {
      flex: none;
      opacity: 0.8;
    }
    .id {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      flex: none;
      font-size: 11px;
    }
    .badge.update {
      color: var(--vscode-charts-green);
    }
    .badge.updatePartial {
      color: var(--vscode-charts-yellow);
    }
    /* Information, pas alerte : des versions plus récentes existent hors des TFM
       en place. Rester sur une LTS pendant que l'écosystème publie pour la
       version suivante est un choix, d'où le bleu d'info et non un rouge. */
    .badge.outOfTfm {
      color: var(--vscode-charts-blue);
    }
    .badge.upToDate,
    .badge.unknown,
    .badge.loading {
      color: var(--vscode-descriptionForeground);
    }
  `;

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("package")) {
      this.iconFailed = false;
    }
  }

  render() {
    // Les trois états « il existe plus récent » partagent la flèche : c'est la
    // couleur, et le libellé au survol, qui portent la nuance.
    const title = this.i18n.t(`packages.list.badge.${this.badge}`);
    const badgeIcon = {
      loading: ellipsisIcon(12),
      update: arrowUpIcon(12, title),
      updatePartial: arrowUpIcon(12, title),
      outOfTfm: arrowUpIcon(12, title),
      upToDate: checkIcon(12, title),
      unknown: helpIcon(12, title),
    }[this.badge];
    return html` <div
      class="row ${this.selected ? "selected" : ""}"
      @click=${() =>
        this.dispatchEvent(
          new CustomEvent("package-selected", {
            detail: { packageId: this.package.id },
            bubbles: true,
            composed: true,
          }),
        )}
    >
      ${
        this.iconFailed
          ? defaultPackageIcon(16)
          : html`<img
              class="icon"
              loading="lazy"
              src=${this.package.iconUrl}
              @error=${() => (this.iconFailed = true)}
            />`
      }
      <span class="id">${this.package.id}</span>
      <span class="badge ${this.badge}" title=${title}>${badgeIcon}</span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "package-list-item": PackageListItem;
  }
}
