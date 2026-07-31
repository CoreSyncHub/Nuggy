import { html, css, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { container } from "tsyringe";
import { type PackageSearchHitDto } from "@Shared/Features/Dtos/SearchResultsDto";
import { TranslationService } from "../../Core/Services/TranslationService";
import { defaultPackageIcon } from "./DefaultPackageIcon";
import { verifiedBadgeIcon, VERIFIED_BLUE } from "./VerifiedBadgeIcon";
import { formatCount } from "../../Shared/Utils/Formatting";

/**
 * Ligne de résultat distant. Volontairement sans badge de compatibilité : la
 * compatibilité dépend du couple package + version, et se lit dans le détail.
 */
@customElement("package-search-item")
export class PackageSearchItem extends LitElement {
  @property({ attribute: false }) hit!: PackageSearchHitDto;
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

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("hit")) {
      this.iconFailed = false;
    }
  }

  static styles = css`
    :host {
      display: block;
    }
    .row {
      display: flex;
      gap: 8px;
      padding: 5px 8px;
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
      width: 24px;
      height: 24px;
      flex: none;
    }
    .body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .id {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .version {
      flex: none;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .description {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      font-size: 10.5px;
      color: var(--vscode-descriptionForeground);
    }
  `;

  render() {
    const downloads =
      this.hit.totalDownloads === undefined
        ? nothing
        : html`<span class="meta"
            >${this.i18n.t("packages.list.downloads", {
              count: formatCount(this.hit.totalDownloads, this.i18n.getCurrentLanguage()),
            })}</span
          >`;
    return html`<div
      class="row ${this.selected ? "selected" : ""}"
      @click=${() =>
        this.dispatchEvent(
          new CustomEvent("package-selected", {
            detail: { packageId: this.hit.id },
            bubbles: true,
            composed: true,
          }),
        )}
    >
      ${
        this.iconFailed || !this.hit.iconUrl
          ? defaultPackageIcon(24)
          : html`<img
              class="icon"
              loading="lazy"
              src=${this.hit.iconUrl}
              @error=${() => (this.iconFailed = true)}
            />`
      }
      <div class="body">
        <div class="title">
          <span class="id">${this.hit.id}</span>
          ${
            this.hit.verified
              ? verifiedBadgeIcon(VERIFIED_BLUE, 12, this.i18n.t("packages.detail.verifiedTooltip"))
              : nothing
          }
          <span class="version">${this.hit.latestVersion}</span>
        </div>
        <div class="description">${this.hit.description}</div>
        ${downloads}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "package-search-item": PackageSearchItem;
  }
}
