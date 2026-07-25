import { html, css, LitElement, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { container } from 'tsyringe';
import { type PackageUpdateInfoDto, type PackageVersionInfoDto } from '@Shared/Features/Dtos/PackageUpdateInfoDto';
import { type SolutionPackageDto } from '@Shared/Features/Dtos/SolutionPackagesDto';
import { TranslationService } from '../../Core/Services/TranslationService';
import { defaultPackageIcon } from './DefaultPackageIcon';
import { verifiedBadgeIcon, VERIFIED_BLUE, MICROSOFT_PURPLE } from './VerifiedBadgeIcon';
import { arrowUpIcon, downloadIcon, globeIcon, licenseIcon, plusIcon, trashIcon } from './Icons';
import './DependencyGroups';
import './ProjectInstallations';

@customElement('package-detail')
export class PackageDetail extends LitElement {
  @property({ attribute: false }) package!: SolutionPackageDto;
  @property({ attribute: false }) info?: PackageUpdateInfoDto;

  @state() private selectedVersion = '';
  @state() private showPrereleases = false;
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

  /** La version sélectionnée et le filtre préversions n'ont de sens que pour le package affiché :
   *  sans ce reset, changer de sélection dans la liste laisse ces états "fuiter" sur le nouveau
   *  package (ex. une version choisie sur X qui n'existe pas pour Y, ou un filtre préversions
   *  resté coché). On ne réinitialise que lorsque l'identité du package change réellement — pas à
   *  chaque re-rendu déclenché par l'arrivée asynchrone de `.info` pour le même package. */
  protected willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('package')) return;
    const previous = changed.get('package');
    if (previous && previous.id !== this.package.id) {
      this.selectedVersion = '';
      this.showPrereleases = false;
      this.iconFailed = false;
    }
  }

  static styles = css`
    :host { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
    /* L'icône (64 px) est l'étalon de hauteur du header : l'identité se
       distribue verticalement dessus, les contrôles vivent dans un bandeau
       dédié pleine largeur en dessous (motif toolbar VS Code). */
    .header { display: flex; gap: 14px; height: 64px; padding: 14px 14px 10px; }
    img.big-icon, .header svg.default-icon { width: 64px; height: 64px; border-radius: 10px; flex: none; }
    .identity { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; padding: 2px 0; }
    .name-row { display: flex; align-items: center; gap: 8px; }
    .name { font-size: 16px; font-weight: 600; }
    .name-row svg { flex: none; }
    .meta { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .links-tags {
      display: flex; align-items: center; gap: 8px;
      font-size: 11px; color: var(--vscode-descriptionForeground);
      white-space: nowrap; overflow: hidden;
    }
    .links-tags a {
      color: var(--vscode-textLink-foreground);
      display: inline-flex; align-items: center; gap: 3px; flex: none;
    }
    .tag { flex: none; border: 1px solid var(--vscode-panel-border); border-radius: 9px;
           padding: 0 8px; font-size: 10px; line-height: 14px; }
    .toolbar { display: flex; align-items: center; gap: 10px; padding: 6px 14px; margin-top: 6px;
               background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
               border-top: 1px solid var(--vscode-panel-border);
               border-bottom: 1px solid var(--vscode-panel-border); }
    select, button { background: var(--vscode-input-background); color: var(--vscode-input-foreground);
                     border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 2px 10px; }
    .spacer { flex: 1; }
    button.global { font-size: 14px; }
    button:disabled { opacity: 0.45; }
    label.prerelease { font-size: 11px; display: flex; align-items: center; gap: 4px; }
    .body { padding: 0 14px 14px; }
    .status { color: var(--vscode-descriptionForeground); padding: 14px; }
  `;

  private get installedIsPrerelease(): boolean {
    return this.package.installations.some((i) => i.installedVersion.includes('-'));
  }

  private get visibleVersions(): PackageVersionInfoDto[] {
    const all = this.info?.versions ?? [];
    if (this.showPrereleases || this.installedIsPrerelease) return all;
    return all.filter((v) => !v.isPrerelease);
  }

  private get currentVersion(): PackageVersionInfoDto | undefined {
    const versions = this.visibleVersions;
    return versions.find((v) => v.version === this.selectedVersion) ?? versions[0];
  }

  private formatDownloads(n?: number): string {
    return n === undefined ? '' : n.toLocaleString('fr-FR');
  }

  render() {
    if (!this.info) return html`<div class="status">${this.i18n.t('packages.detail.loading')}</div>`;
    if (this.info.fetchStatus !== 'Ok') {
      const message = {
        Offline: this.i18n.t('packages.detail.fetchStatus.offline'),
        NotFound: this.i18n.t('packages.detail.fetchStatus.notFound'),
        RateLimited: this.i18n.t('packages.detail.fetchStatus.rateLimited'),
      }[this.info.fetchStatus];
      return html`<div class="status">${message}</div>`;
    }

    const current = this.currentVersion;
    const published = this.info.publishedUtc
      ? new Date(this.info.publishedUtc).toLocaleDateString('fr-FR')
      : undefined;
    const downloads = this.formatDownloads(this.info.totalDownloads) || undefined;

    return html`
      <div class="header">
        ${this.iconFailed
          ? defaultPackageIcon(64)
          : html`<img class="big-icon" src=${this.package.iconUrl}
                      @error=${() => (this.iconFailed = true)} />`}
        <div class="identity">
          <div class="name-row">
            <span class="name">${this.info.id}</span>
            ${this.info.isMicrosoft
              ? verifiedBadgeIcon(MICROSOFT_PURPLE, 18, this.i18n.t('packages.detail.microsoftTooltip'))
              : this.info.verified
                ? verifiedBadgeIcon(VERIFIED_BLUE, 18, this.i18n.t('packages.detail.verifiedTooltip'))
                : nothing}
          </div>
          <div class="meta">
            ${this.i18n.t('packages.detail.byAuthor', { author: this.info.authors })}${published
              ? html` · ${published}`
              : nothing}${downloads
              ? html` · ${downloadIcon(11)} ${downloads}`
              : nothing}
          </div>
          <div class="links-tags">
            <a href=${this.info.links.nugetPage}>${defaultPackageIcon(11)} nuget.org</a>
            ${this.info.links.projectSite
              ? html`<a href=${this.info.links.projectSite}>${globeIcon(11)} ${this.i18n.t('packages.detail.projectSiteLink')}</a>`
              : nothing}
            ${this.info.links.license?.url
              ? html`<a href=${this.info.links.license.url}>${licenseIcon(11)} ${this.info.links.license.expression ?? this.i18n.t('packages.detail.license')}</a>`
              : nothing}
            ${this.info.tags.map((t) => html`<span class="tag">${t}</span>`)}
          </div>
        </div>
      </div>
      <div class="toolbar">
        <select @change=${(e: Event) => (this.selectedVersion = (e.target as HTMLSelectElement).value)}>
          ${this.visibleVersions.map(
            (v) => html`<option value=${v.version} ?selected=${v.version === current?.version}>v ${v.version}</option>`
          )}
        </select>
        <select disabled title=${this.i18n.t('packages.detail.sourceComingSoon')}>
          <option>nuget.org</option>
        </select>
        <label class="prerelease">
          <input type="checkbox" .checked=${this.showPrereleases}
                 ?disabled=${this.installedIsPrerelease}
                 @change=${(e: Event) => (this.showPrereleases = (e.target as HTMLInputElement).checked)} />
          ${this.i18n.t('packages.detail.prereleaseLabel')}
        </label>
        <span class="spacer"></span>
        <button class="global" disabled title=${this.i18n.t('packages.detail.globalActionTooltip', { action: this.i18n.t('packages.detail.installEverywhere') })}>${plusIcon(14)}</button>
        <button class="global" disabled title=${this.i18n.t('packages.detail.globalActionTooltip', { action: this.i18n.t('packages.detail.updateAllEverywhere') })}>${arrowUpIcon(14)}</button>
        <button class="global" disabled title=${this.i18n.t('packages.detail.globalActionTooltip', { action: this.i18n.t('packages.detail.uninstallEverywhere') })}>${trashIcon(14)}</button>
      </div>
      <div class="body">
        ${current
          ? html`<project-installations .installations=${this.package.installations} .selectedVersion=${current}></project-installations>
                 <dependency-groups .groups=${current.dependencyGroups} .version=${current.version}></dependency-groups>`
          : nothing}
      </div>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'package-detail': PackageDetail; } }
