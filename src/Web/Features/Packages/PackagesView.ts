import { html, css, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { container } from 'tsyringe';
import { DISPATCHER, type IDispatcher } from '@Shared/Abstractions/Messaging/IDispatcher';
import { type ILogger, LOGGER } from '@/Host/Application/Abstractions/Log/ILogger';
import { GetSolutionPackagesQuery } from '@Shared/Features/Queries/GetSolutionPackagesQuery';
import { GetWorkspaceSolutionsQuery } from '@Shared/Features/Queries/GetWorkspaceSolutionsQuery';
import { GetPackageUpdateInfoQuery } from '@Shared/Features/Queries/GetPackageUpdateInfoQuery';
import { type SolutionDto } from '@Shared/Features/Dtos/SolutionDto';
import { type SolutionPackagesDto } from '@Shared/Features/Dtos/SolutionPackagesDto';
import { type PackageUpdateInfoDto } from '@Shared/Features/Dtos/PackageUpdateInfoDto';
import { TranslationService } from '../../Core/Services/TranslationService';
import './PackageList';
import './PackageDetail';

@customElement('packages-view')
export class PackagesView extends LitElement {
  private static readonly BATCH_SIZE = 5;

  @state() private data?: SolutionPackagesDto;
  @state() private selectedId = '';
  @state() private verdictBadges = new Map<string, string>();
  /** Résultats en échec (fetchStatus !== 'Ok') volontairement absents de ce cache : les conserver
   *  figerait un DTO synthétique 'Offline' pour toujours, empêchant toute nouvelle tentative. */
  protected readonly updateInfoCache = new Map<string, PackageUpdateInfoDto>();
  /** Dernier DTO reçu (succès OU échec) pour le package actuellement sélectionné, utilisé par le
   *  rendu du détail. Transitoire par design : contrairement à updateInfoCache, il n'est jamais lu
   *  pour décider si un fetch peut être évité — resélectionner un package en échec relance toujours
   *  loadUpdateInfo. */
  @state() private selectedInfo?: PackageUpdateInfoDto;

  private dispatcher!: IDispatcher;
  private logger!: ILogger;
  private i18n!: TranslationService;
  private unsubscribeI18n?: () => void;
  /** Résolu à la connexion via GetWorkspaceSolutionsQuery (solution marquée isSelected, sinon la première détectée). */
  protected solutionPath = '';

  static styles = css`
    :host {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      font-size: 13px;
      color: var(--vscode-foreground);
    }
    .detail-placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); }
    .splitter {
      flex: none;
      width: 4px;
      cursor: col-resize;
      background: var(--vscode-panel-border);
      transition: background 0.15s;
    }
    .splitter:hover,
    .splitter.dragging {
      background: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
    }
  `;

  @state() private listWidth = 340;
  @state() private isResizing = false;

  private static readonly LIST_MIN_WIDTH = 180;
  private static readonly LIST_MAX_WIDTH = 600;

  private onSplitterPointerDown(e: PointerEvent): void {
    const splitter = e.currentTarget as HTMLElement;
    splitter.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = this.listWidth;
    this.isResizing = true;

    const onMove = (move: PointerEvent) => {
      const width = startWidth + (move.clientX - startX);
      this.listWidth = Math.min(
        PackagesView.LIST_MAX_WIDTH,
        Math.max(PackagesView.LIST_MIN_WIDTH, width)
      );
    };
    const onUp = (up: PointerEvent) => {
      splitter.releasePointerCapture(up.pointerId);
      splitter.removeEventListener('pointermove', onMove);
      splitter.removeEventListener('pointerup', onUp);
      this.isResizing = false;
    };
    splitter.addEventListener('pointermove', onMove);
    splitter.addEventListener('pointerup', onUp);
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.dispatcher = container.resolve<IDispatcher>(DISPATCHER.token);
    this.logger = container.resolve<ILogger>(LOGGER.token);
    this.i18n = container.resolve(TranslationService);
    this.unsubscribeI18n = this.i18n.subscribe(() => this.requestUpdate());
    void this.initialize();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeI18n?.();
  }

  private async initialize(): Promise<void> {
    try {
      await this.resolveSolutionPath();
      await this.loadPackages();
      void this.fillBadges();
    } catch (error) {
      this.logger.Error('Failed to load packages view data', error as Error);
    }
  }

  /** Détermine la solution active de la même façon que le reste de l'extension : la solution marquée `isSelected` (persistée en workspace settings via SelectSolutionCommand), avec repli sur la première solution détectée. */
  private async resolveSolutionPath(): Promise<void> {
    const solutions = (await this.dispatcher.Send(new GetWorkspaceSolutionsQuery())) as SolutionDto[];
    const solution = solutions.find((s) => s.isSelected) ?? solutions[0];
    if (!solution) {
      this.logger.Warning('Aucune solution détectée dans le workspace : la vue packages restera vide.');
      return;
    }
    this.solutionPath = solution.path;
  }

  protected async loadPackages(): Promise<void> {
    if (!this.solutionPath) return;
    this.data = await this.dispatcher.Send(new GetSolutionPackagesQuery(this.solutionPath));
    this.requestUpdate();
  }

  protected async fillBadges(): Promise<void> {
    const ids = (this.data?.packages ?? []).map((p) => p.id);
    for (let i = 0; i < ids.length; i += PackagesView.BATCH_SIZE) {
      const batch = ids.slice(i, i + PackagesView.BATCH_SIZE);
      const results = await Promise.all(batch.map((id) => this.loadUpdateInfo(id)));
      // Nouvelle Map : déclenche le re-render de package-list
      this.verdictBadges = new Map(this.verdictBadges);
      // HTTP 429 : on met la file en pause plutôt que d'amplifier la limitation en enchaînant les
      // lots suivants. Les badges restants gardent volontairement leur état par défaut 'loading'
      // (glyphe '…') plutôt qu'un 'unknown' trompeur — un reload ou une resélection relance le fetch.
      if (results.some((info) => info.fetchStatus === 'RateLimited')) {
        this.logger.Warning('nuget.org limite les requêtes (429) : file des badges mise en pause.');
        break;
      }
    }
  }

  protected async loadUpdateInfo(packageId: string): Promise<PackageUpdateInfoDto> {
    const cached = this.updateInfoCache.get(packageId);
    if (cached) {
      if (packageId === this.selectedId) this.selectedInfo = cached;
      return cached;
    }
    try {
      const info = (await this.dispatcher.Send(
        new GetPackageUpdateInfoQuery(packageId, this.solutionPath)
      )) as PackageUpdateInfoDto;
      // Ne mettre en cache que les succès : un DTO d'échec caché figerait le statut pour toujours
      // et empêcherait toute nouvelle tentative lors d'une resélection du package.
      if (info.fetchStatus === 'Ok') {
        this.updateInfoCache.set(packageId, info);
      }
      this.verdictBadges.set(packageId, this.aggregateBadge(info));
      if (packageId === this.selectedId) this.selectedInfo = info;
      return info;
    } catch {
      const fallback: PackageUpdateInfoDto = {
        id: packageId,
        verified: false,
        isMicrosoft: false,
        authors: '',
        tags: [],
        links: { nugetPage: `https://www.nuget.org/packages/${packageId}` },
        versions: [],
        fetchStatus: 'Offline',
      };
      this.verdictBadges.set(packageId, 'unknown');
      if (packageId === this.selectedId) this.selectedInfo = fallback;
      return fallback;
    }
  }

  private aggregateBadge(info: PackageUpdateInfoDto): string {
    if (info.fetchStatus !== 'Ok' || !info.latestStable) return 'unknown';
    const latest = info.versions.find((v) => v.version === info.latestStable);
    if (!latest) return 'unknown';
    const verdicts = latest.verdictsByProject.map((p) => p.verdict);
    if (verdicts.some((v) => v === 'Unknown')) return 'unknown';
    if (verdicts.every((v) => v === 'Compatible')) return 'ok';
    if (verdicts.every((v) => v === 'Incompatible')) return 'incompatible';
    return 'partial';
  }

  private onPackageSelected(e: CustomEvent<{ packageId: string }>): void {
    this.selectedId = e.detail.packageId;
    // Reflète immédiatement le dernier état connu (cache de succès, sinon 'loading' via undefined) ;
    // loadUpdateInfo relance toujours un fetch Host si aucun succès n'est en cache pour ce package.
    this.selectedInfo = this.updateInfoCache.get(this.selectedId);
    void this.loadUpdateInfo(this.selectedId).then(() => this.requestUpdate());
  }

  render() {
    const selected = this.data?.packages.find((p) => p.id === this.selectedId);
    return html`
      <package-list
        .packages=${this.data?.packages ?? []}
        .verdictBadges=${this.verdictBadges}
        .uninterrogatedFeeds=${this.data?.uninterrogatedFeeds ?? []}
        .selectedId=${this.selectedId}
        style="width: ${this.listWidth}px"
        @package-selected=${this.onPackageSelected}></package-list>
      <div
        class="splitter ${this.isResizing ? 'dragging' : ''}"
        @pointerdown=${this.onSplitterPointerDown}></div>
      ${selected
        ? html`<package-detail .package=${selected} .info=${this.selectedInfo}></package-detail>`
        : html`<div class="detail-placeholder">${this.i18n.t('packages.noPackageSelected')}</div>`}`;
  }
}

declare global { interface HTMLElementTagNameMap { 'packages-view': PackagesView; } }
