import { html, css, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
// Le tri se réordonne à mesure que les badges arrivent : sans rendu keyé, Lit
// réutiliserait les lignes par position et attribuerait icône et sélection au
// mauvais package.
import { repeat } from "lit/directives/repeat.js";
import { container } from "tsyringe";
import { type SolutionPackageDto } from "@Shared/Features/Dtos/SolutionPackagesDto";
import {
  UPDATE_STATE_RANK,
  type PackageUpdateState,
} from "@Shared/Features/Packages/PackageUpdateState";
import { TranslationService } from "../../Core/Services/TranslationService";
import { searchIcon, warningIcon } from "./Icons";
import "./PackageListItem";

@customElement("package-list")
export class PackageList extends LitElement {
  @property({ attribute: false }) packages: SolutionPackageDto[] = [];
  @property({ attribute: false }) verdictBadges = new Map<string, PackageUpdateState>();
  @property() selectedId = "";
  @property({ attribute: false }) uninterrogatedFeeds: string[] = [];

  @state() private filterText = "";
  @state() private filterState = "all";

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
      display: flex;
      flex-direction: column;
      flex: none;
      overflow: hidden;
    }
    .filters {
      display: flex;
      gap: 4px;
      padding: 6px;
    }
    .search-box {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px;
      padding: 2px 6px;
    }
    .search-box svg {
      flex: none;
      color: var(--vscode-descriptionForeground);
    }
    .search-box input {
      flex: 1;
      min-width: 0;
      background: none;
      border: none;
      outline: none;
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: 12px;
    }
    select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px;
      padding: 2px 6px;
      font-family: inherit;
      font-size: 12px;
      min-width: 0;
    }
    .list {
      overflow-y: auto;
      flex: 1;
    }
    .feeds-banner {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      padding: 4px 8px;
      color: var(--vscode-descriptionForeground);
    }
    .feeds-banner svg {
      flex: none;
    }
  `;

  /** Les badges arrivent par lots : un package encore en cours reste en fin de
   *  liste plutôt que de prendre la place d'un résultat déjà connu. */
  private static readonly LOADING_RANK = Number.MAX_SAFE_INTEGER;

  private rankOf(packageId: string): number {
    const badge = this.verdictBadges.get(packageId);
    return badge === undefined ? PackageList.LOADING_RANK : UPDATE_STATE_RANK[badge];
  }

  /** Packages montables d'abord, puis alphabétique — ce qui est actionnable
   *  doit se voir sans défiler. Le tri se réajuste au fil des badges reçus. */
  private get visiblePackages(): SolutionPackageDto[] {
    const text = this.filterText.toLowerCase();
    return this.packages
      .filter((p) => {
        if (text && !p.id.toLowerCase().includes(text)) {
          return false;
        }
        if (this.filterState !== "all" && this.verdictBadges.get(p.id) !== this.filterState) {
          return false;
        }
        return true;
      })
      .sort((a, b) => this.rankOf(a.id) - this.rankOf(b.id) || a.id.localeCompare(b.id));
  }

  render() {
    return html` <div class="filters">
        <div class="search-box">
          ${searchIcon(13)}
          <input
            placeholder=${this.i18n.t("packages.list.filterPlaceholder")}
            .value=${this.filterText}
            @input=${(e: InputEvent) => (this.filterText = (e.target as HTMLInputElement).value)}
          />
        </div>
        <select @change=${(e: Event) => (this.filterState = (e.target as HTMLSelectElement).value)}>
          <option value="all">${this.i18n.t("packages.list.filterAll")}</option>
          <option value="update">${this.i18n.t("packages.list.badge.update")}</option>
          <option value="updatePartial">${this.i18n.t("packages.list.badge.updatePartial")}</option>
          <option value="outOfTfm">${this.i18n.t("packages.list.filterOutOfTfm")}</option>
          <option value="upToDate">${this.i18n.t("packages.list.badge.upToDate")}</option>
          <option value="unknown">${this.i18n.t("packages.list.badge.unknown")}</option>
        </select>
      </div>
      ${
        this.uninterrogatedFeeds.length > 0
          ? html`<div class="feeds-banner">
              ${warningIcon(12)} ${this.uninterrogatedFeeds.join(", ")}
            </div>`
          : ""
      }
      <div class="list">
        ${repeat(
          this.visiblePackages,
          (p) => p.id,
          (p) =>
            html`<package-list-item
              .package=${p}
              .badge=${this.verdictBadges.get(p.id) ?? "loading"}
              .selected=${p.id === this.selectedId}
            ></package-list-item>`,
        )}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "package-list": PackageList;
  }
}
