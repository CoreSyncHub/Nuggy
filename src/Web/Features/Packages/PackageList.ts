import { html, css, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
// The sort reorders itself as badges arrive: without keyed rendering, Lit would
// reuse the rows by position and hand icon and selection to the wrong package.
import { repeat } from "lit/directives/repeat.js";
import { container } from "tsyringe";
import { type PackageSearchHitDto } from "@Shared/Features/Dtos/SearchResultsDto";
import { type SolutionPackageDto } from "@Shared/Features/Dtos/SolutionPackagesDto";
import {
  UPDATE_STATE_RANK,
  type PackageUpdateState,
} from "@Shared/Features/Packages/PackageUpdateState";
import { TranslationService } from "../../Core/Services/TranslationService";
import { searchIcon, warningIcon } from "./Icons";
import "./PackageListItem";
import "./PackageSearchItem";

@customElement("package-list")
export class PackageList extends LitElement {
  @property({ attribute: false }) packages: SolutionPackageDto[] = [];
  @property({ attribute: false }) verdictBadges = new Map<string, PackageUpdateState>();
  @property() selectedId = "";
  @property({ attribute: false }) uninterrogatedFeeds: string[] = [];
  @property({ attribute: false }) searchHits: PackageSearchHitDto[] = [];
  @property({ type: Boolean }) searchLoading = false;
  @property({ type: Boolean }) hasMore = false;
  /** No source answered: to be told apart from a search without results, or the
   *  user would believe the package does not exist. */
  @property({ type: Boolean }) allSourcesFailed = false;

  /** Single field: filters the installed packages AND feeds the remote search. */
  @state() private filterText = "";
  @state() private filterState = "all";
  @state() private includePrerelease = false;
  private searchDebounce?: ReturnType<typeof setTimeout>;

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
    if (this.searchDebounce) {
      clearTimeout(this.searchDebounce);
    }
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
    .hint {
      padding: 12px 8px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      text-align: center;
    }
    /* Section header: only appears while a search is in progress, to separate
       what is already in the solution from what comes from the feed. */
    .section {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 8px 4px;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--vscode-descriptionForeground);
      border-top: 1px solid var(--vscode-panel-border);
    }
    .list > .section:first-child {
      border-top: none;
    }
    .section label.prerelease {
      margin-left: auto;
      text-transform: none;
      letter-spacing: 0;
    }
    label.prerelease {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    button.load-more {
      display: block;
      width: calc(100% - 16px);
      margin: 8px;
      padding: 4px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      cursor: pointer;
    }
    button.load-more:disabled {
      opacity: 0.45;
      cursor: default;
    }
  `;

  /** Badges arrive in batches: a package still loading stays at the end of the
   *  list rather than taking the place of an already-known result. */
  private static readonly LOADING_RANK = Number.MAX_SAFE_INTEGER;

  private rankOf(packageId: string): number {
    const badge = this.verdictBadges.get(packageId);
    return badge === undefined ? PackageList.LOADING_RANK : UPDATE_STATE_RANK[badge];
  }

  /** Upgradable packages first, then alphabetical — what is actionable must be
   *  visible without scrolling. The sort readjusts as badges come in. */
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

  private static readonly SEARCH_DEBOUNCE_MS = 300;
  private static readonly SEARCH_MIN_LENGTH = 2;

  /** The field is empty: only the installed packages are shown, without sections. */
  private get isSearching(): boolean {
    return this.filterText.trim().length > 0;
  }

  private get canQuery(): boolean {
    return this.filterText.trim().length >= PackageList.SEARCH_MIN_LENGTH;
  }

  /** Installed packages are already listed: no point repeating them in the results. */
  private get remoteOnlyHits(): PackageSearchHitDto[] {
    const installed = new Set(this.packages.map((p) => p.id.toLowerCase()));
    return this.searchHits.filter((h) => !installed.has(h.id.toLowerCase()));
  }

  /**
   * Debounce: fast typing must not fire one request per character.
   * Below the threshold, we explicitly ask for the previous results to be dropped —
   * otherwise those of an abandoned search would reappear on the next keystroke.
   */
  private scheduleSearch(): void {
    if (this.searchDebounce) {
      clearTimeout(this.searchDebounce);
    }
    this.searchDebounce = setTimeout(() => {
      const terms = this.filterText.trim();
      if (terms.length < PackageList.SEARCH_MIN_LENGTH) {
        this.dispatchEvent(new CustomEvent("search-cleared", { bubbles: true, composed: true }));
        return;
      }
      this.dispatchEvent(
        new CustomEvent("search-terms-changed", {
          detail: { terms, includePrerelease: this.includePrerelease },
          bubbles: true,
          composed: true,
        }),
      );
    }, PackageList.SEARCH_DEBOUNCE_MS);
  }

  render() {
    return html` <div class="filters">
        <div class="search-box">
          ${searchIcon(13)}
          <input
            placeholder=${this.i18n.t("packages.list.filterPlaceholder")}
            .value=${this.filterText}
            @input=${(e: InputEvent) => {
              this.filterText = (e.target as HTMLInputElement).value;
              this.scheduleSearch();
            }}
          />
        </div>
        <select
          .value=${this.filterState}
          @change=${(e: Event) => (this.filterState = (e.target as HTMLSelectElement).value)}
        >
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
        ${
          this.isSearching
            ? html`<div class="section">${this.i18n.t("packages.list.sectionInstalled")}</div>`
            : nothing
        }
        ${this.renderInstalled()} ${this.isSearching ? this.renderSearchSection() : nothing}
      </div>`;
  }

  private renderInstalled() {
    if (this.isSearching && this.visiblePackages.length === 0) {
      return html`<div class="hint">${this.i18n.t("packages.list.noInstalledMatch")}</div>`;
    }
    return repeat(
      this.visiblePackages,
      (p) => p.id,
      (p) =>
        html`<package-list-item
          .package=${p}
          .badge=${this.verdictBadges.get(p.id) ?? "loading"}
          .selected=${p.id === this.selectedId}
        ></package-list-item>`,
    );
  }

  /** Remote section: header, prerelease option, results and pagination. */
  private renderSearchSection() {
    return html`<div class="section">
        ${this.i18n.t("packages.list.sectionResults")}
        <label class="prerelease">
          <input
            type="checkbox"
            .checked=${this.includePrerelease}
            @change=${(e: Event) => {
              this.includePrerelease = (e.target as HTMLInputElement).checked;
              this.scheduleSearch();
            }}
          />
          ${this.i18n.t("packages.list.includePrerelease")}
        </label>
      </div>
      ${this.renderSearchResults()}`;
  }

  private renderSearchResults() {
    if (!this.canQuery) {
      return html`<div class="hint">${this.i18n.t("packages.list.searchHint")}</div>`;
    }
    const hits = this.remoteOnlyHits;
    if (this.searchLoading && hits.length === 0) {
      return html`<div class="hint">${this.i18n.t("packages.list.searching")}</div>`;
    }
    if (hits.length === 0) {
      return html`<div class="hint">
        ${
          this.allSourcesFailed
            ? this.i18n.t("packages.list.allSourcesFailed")
            : this.i18n.t("packages.list.noResults")
        }
      </div>`;
    }
    return html`${repeat(
      hits,
      (h) => `${h.sourceName}|${h.id}`,
      (h) =>
        html`<package-search-item
          .hit=${h}
          .selected=${h.id === this.selectedId}
        ></package-search-item>`,
    )}
    ${
      this.hasMore
        ? html`<button
            class="load-more"
            ?disabled=${this.searchLoading}
            @click=${() =>
              this.dispatchEvent(new CustomEvent("load-more", { bubbles: true, composed: true }))}
          >
            ${
              this.searchLoading
                ? this.i18n.t("packages.list.searching")
                : this.i18n.t("packages.list.loadMore")
            }
          </button>`
        : nothing
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "package-list": PackageList;
  }
}
