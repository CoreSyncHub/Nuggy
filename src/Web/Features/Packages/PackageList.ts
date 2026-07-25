import { html, css, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { container } from 'tsyringe';
import { type SolutionPackageDto } from '@Shared/Features/Dtos/SolutionPackagesDto';
import { TranslationService } from '../../Core/Services/TranslationService';
import { searchIcon, warningIcon } from './Icons';
import './PackageListItem';

@customElement('package-list')
export class PackageList extends LitElement {
  @property({ attribute: false }) packages: SolutionPackageDto[] = [];
  @property({ attribute: false }) verdictBadges = new Map<string, string>();
  @property() selectedId = '';
  @property({ attribute: false }) uninterrogatedFeeds: string[] = [];

  @state() private filterText = '';
  @state() private filterVerdict = 'all';

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
    :host { display: flex; flex-direction: column; flex: none; overflow: hidden; }
    .filters { display: flex; gap: 4px; padding: 6px; }
    .search-box {
      flex: 1; display: flex; align-items: center; gap: 4px; min-width: 0;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 2px 6px;
    }
    .search-box svg { flex: none; color: var(--vscode-descriptionForeground); }
    .search-box input {
      flex: 1; min-width: 0; background: none; border: none; outline: none;
      color: var(--vscode-input-foreground); font-family: inherit; font-size: 12px;
    }
    select {
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 2px 6px;
      font-family: inherit; font-size: 12px; min-width: 0;
    }
    .list { overflow-y: auto; flex: 1; }
    .feeds-banner {
      display: flex; align-items: center; gap: 5px;
      font-size: 11px; padding: 4px 8px; color: var(--vscode-descriptionForeground);
    }
    .feeds-banner svg { flex: none; }
  `;

  private get visiblePackages(): SolutionPackageDto[] {
    const text = this.filterText.toLowerCase();
    return this.packages.filter((p) => {
      if (text && !p.id.toLowerCase().includes(text)) return false;
      if (this.filterVerdict !== 'all' && (this.verdictBadges.get(p.id) ?? 'loading') !== this.filterVerdict) return false;
      return true;
    });
  }

  render() {
    return html`
      <div class="filters">
        <div class="search-box">
          ${searchIcon(13)}
          <input placeholder=${this.i18n.t('packages.list.filterPlaceholder')} .value=${this.filterText}
                 @input=${(e: InputEvent) => (this.filterText = (e.target as HTMLInputElement).value)} />
        </div>
        <select @change=${(e: Event) => (this.filterVerdict = (e.target as HTMLSelectElement).value)}>
          <option value="all">${this.i18n.t('packages.list.verdictAll')}</option>
          <option value="ok">${this.i18n.t('packages.list.verdictOk')}</option>
          <option value="partial">${this.i18n.t('packages.list.verdictPartial')}</option>
          <option value="incompatible">${this.i18n.t('packages.list.verdictIncompatible')}</option>
          <option value="unknown">${this.i18n.t('packages.list.verdictUnknown')}</option>
        </select>
      </div>
      ${this.uninterrogatedFeeds.length > 0
        ? html`<div class="feeds-banner">${warningIcon(12)} ${this.uninterrogatedFeeds.join(', ')}</div>`
        : ''}
      <div class="list">
        ${this.visiblePackages.map(
          (p) => html`<package-list-item
            .package=${p}
            .badge=${(this.verdictBadges.get(p.id) ?? 'loading') as never}
            .selected=${p.id === this.selectedId}></package-list-item>`
        )}
      </div>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'package-list': PackageList; } }
