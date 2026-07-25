import { html, css, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { type SolutionPackageDto } from '@Shared/Features/Dtos/SolutionPackagesDto';
import { defaultPackageIcon } from './DefaultPackageIcon';
import { checkIcon, crossIcon, ellipsisIcon, helpIcon, warningIcon } from './Icons';

@customElement('package-list-item')
export class PackageListItem extends LitElement {
  @property({ attribute: false }) package!: SolutionPackageDto;
  @property() badge: 'loading' | 'ok' | 'partial' | 'incompatible' | 'unknown' = 'loading';
  @property({ type: Boolean }) selected = false;

  @state() private iconFailed = false;

  static styles = css`
    :host { display: block; }
    .row {
      display: flex; align-items: center; gap: 6px;
      padding: 3px 8px; cursor: pointer; border-radius: 4px;
      color: var(--vscode-foreground);
    }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    .row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    img.icon { width: 16px; height: 16px; flex: none; }
    svg { flex: none; opacity: 0.8; }
    .id { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { flex: none; font-size: 11px; }
    .badge.ok { color: var(--vscode-charts-green); }
    .badge.partial { color: var(--vscode-charts-orange); }
    .badge.incompatible { color: var(--vscode-charts-red); }
    .badge.unknown, .badge.loading { color: var(--vscode-descriptionForeground); }
  `;

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('package')) {
      this.iconFailed = false;
    }
  }

  render() {
    const badgeIcon = {
      loading: ellipsisIcon(12),
      ok: checkIcon(12),
      partial: warningIcon(12),
      incompatible: crossIcon(12),
      unknown: helpIcon(12),
    }[this.badge];
    return html`
      <div class="row ${this.selected ? 'selected' : ''}"
           @click=${() => this.dispatchEvent(new CustomEvent('package-selected', {
             detail: { packageId: this.package.id }, bubbles: true, composed: true }))}>
        ${this.iconFailed
          ? defaultPackageIcon(16)
          : html`<img class="icon" loading="lazy" src=${this.package.iconUrl}
                      @error=${() => (this.iconFailed = true)} />`}
        <span class="id">${this.package.id}</span>
        <span class="badge ${this.badge}">${badgeIcon}</span>
      </div>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'package-list-item': PackageListItem; } }
