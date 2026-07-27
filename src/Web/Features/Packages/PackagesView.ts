import { html, css, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { container } from "tsyringe";
import { DISPATCHER, type IDispatcher } from "@Shared/Abstractions/Messaging/IDispatcher";
import { type ILogger, LOGGER } from "@/Host/Application/Abstractions/Log/ILogger";
import { GetSolutionPackagesQuery } from "@Shared/Features/Queries/GetSolutionPackagesQuery";
import { GetWorkspaceSolutionsQuery } from "@Shared/Features/Queries/GetWorkspaceSolutionsQuery";
import { GetPackageUpdateInfoQuery } from "@Shared/Features/Queries/GetPackageUpdateInfoQuery";
import { GetRestoreStatusQuery } from "@Shared/Features/Queries/GetRestoreStatusQuery";
import { InstallPackageCommand } from "@Shared/Features/Commands/InstallPackageCommand";
import { UpgradePackageCommand } from "@Shared/Features/Commands/UpgradePackageCommand";
import { UninstallPackageCommand } from "@Shared/Features/Commands/UninstallPackageCommand";
import { type SolutionDto } from "@Shared/Features/Dtos/SolutionDto";
import { type SolutionPackagesDto } from "@Shared/Features/Dtos/SolutionPackagesDto";
import { type PackageUpdateInfoDto } from "@Shared/Features/Dtos/PackageUpdateInfoDto";
import { type PackageWriteResultDto } from "@Shared/Features/Dtos/PackageWriteResultDto";
import { type RestoreStatusDto } from "@Shared/Features/Dtos/RestoreStatusDto";
import { TranslationService } from "../../Core/Services/TranslationService";
import "./PackageList";
import "./PackageDetail";

@customElement("packages-view")
export class PackagesView extends LitElement {
  private static readonly BATCH_SIZE = 5;
  private static readonly RESTORE_POLL_INTERVAL_MS = 1_000;
  /** Doit dépasser le budget total côté Host (300 s restore, cf. RestoreScheduler.RESTORE_TIMEOUT_MS,
   *  + 60 s d'enrichissement dotnet nuget why en cas d'échec, cf. RestoreScheduler.WHY_TOTAL_BUDGET_MS,
   *  + marge) pour ne jamais couper le polling avant que le Host n'ait pu publier son propre état
   *  terminal (Finding 4). */
  private static readonly RESTORE_POLL_TIMEOUT_MS = 370_000;
  private static readonly RESTORE_SUCCESS_HIDE_MS = 4_000;

  @state() private data?: SolutionPackagesDto;
  @state() private selectedId = "";
  @state() private verdictBadges = new Map<string, string>();
  /** Résultats en échec (fetchStatus !== 'Ok') volontairement absents de ce cache : les conserver
   *  figerait un DTO synthétique 'Offline' pour toujours, empêchant toute nouvelle tentative. */
  protected readonly updateInfoCache = new Map<string, PackageUpdateInfoDto>();
  /** Dernier DTO reçu (succès OU échec) pour le package actuellement sélectionné, utilisé par le
   *  rendu du détail. Transitoire par design : contrairement à updateInfoCache, il n'est jamais lu
   *  pour décider si un fetch peut être évité — resélectionner un package en échec relance toujours
   *  loadUpdateInfo. */
  @state() private selectedInfo?: PackageUpdateInfoDto;
  /** Projets avec une action d'écriture en cours (Host non encore répondu) — relayé jusqu'aux
   *  cartes de ProjectInstallations pour désactiver leurs boutons et afficher le spinner. */
  @state() private busyProjects = new Set<string>();
  /** Une action globale (toolbar de PackageDetail, sans projectPath) est en cours. */
  @state() private globalBusy = false;
  /** Dernier résultat d'écriture (succès ou échec) : consommé par le bandeau (Task 11). */
  @state() private lastWriteResult?: PackageWriteResultDto;
  /** Dernier statut restore connu (polling démarré après chaque écriture), consommé par le
   *  bandeau. `undefined` tant qu'aucune écriture n'a eu lieu dans la session, et de nouveau après
   *  l'auto-masquage 4 s suivant un `Succeeded` (cf. `startRestorePolling`). */
  @state() private restoreStatus?: RestoreStatusDto;

  private dispatcher!: IDispatcher;
  private logger!: ILogger;
  private i18n!: TranslationService;
  private unsubscribeI18n?: () => void;
  /** Incrémentée à chaque (re)démarrage du polling restore : invalide toute boucle précédente
   *  encore en vol, garantissant qu'une seule tourne à la fois (une écriture pendant un polling en
   *  cours le réarme au lieu d'empiler un second intervalle). */
  private restorePollGeneration = 0;
  private restorePollTimer?: ReturnType<typeof setTimeout>;
  private restoreHideTimer?: ReturnType<typeof setTimeout>;
  /** Résolu à la connexion via GetWorkspaceSolutionsQuery (solution marquée isSelected, sinon la première détectée). */
  protected solutionPath = "";

  static styles = css`
    :host {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      font-size: 13px;
      color: var(--vscode-foreground);
    }
    .detail-placeholder {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--vscode-descriptionForeground);
    }
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
        Math.max(PackagesView.LIST_MIN_WIDTH, width),
      );
    };
    const onUp = (up: PointerEvent) => {
      splitter.releasePointerCapture(up.pointerId);
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onUp);
      this.isResizing = false;
    };
    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
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
    this.restorePollGeneration++;
    if (this.restorePollTimer) {
      clearTimeout(this.restorePollTimer);
    }
    if (this.restoreHideTimer) {
      clearTimeout(this.restoreHideTimer);
    }
  }

  private async initialize(): Promise<void> {
    try {
      await this.resolveSolutionPath();
      await this.loadPackages();
      void this.fillBadges();
    } catch (error) {
      this.logger.Error("Failed to load packages view data", error as Error);
    }
  }

  /** Détermine la solution active de la même façon que le reste de l'extension : la solution marquée `isSelected` (persistée en workspace settings via SelectSolutionCommand), avec repli sur la première solution détectée. */
  private async resolveSolutionPath(): Promise<void> {
    const solutions = (await this.dispatcher.Send(
      new GetWorkspaceSolutionsQuery(),
    )) as SolutionDto[];
    const solution = solutions.find((s) => s.isSelected) ?? solutions[0];
    if (!solution) {
      this.logger.Warning(
        "Aucune solution détectée dans le workspace : la vue packages restera vide.",
      );
      return;
    }
    this.solutionPath = solution.path;
  }

  protected async loadPackages(): Promise<void> {
    if (!this.solutionPath) {
      return;
    }
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
      if (results.some((info) => info.fetchStatus === "RateLimited")) {
        this.logger.Warning("nuget.org limite les requêtes (429) : file des badges mise en pause.");
        break;
      }
    }
  }

  protected async loadUpdateInfo(packageId: string): Promise<PackageUpdateInfoDto> {
    const cached = this.updateInfoCache.get(packageId);
    if (cached) {
      if (packageId === this.selectedId) {
        this.selectedInfo = cached;
      }
      return cached;
    }
    try {
      const info = (await this.dispatcher.Send(
        new GetPackageUpdateInfoQuery(packageId, this.solutionPath),
      )) as PackageUpdateInfoDto;
      // Ne mettre en cache que les succès : un DTO d'échec caché figerait le statut pour toujours
      // et empêcherait toute nouvelle tentative lors d'une resélection du package.
      if (info.fetchStatus === "Ok") {
        this.updateInfoCache.set(packageId, info);
      }
      this.verdictBadges.set(packageId, this.aggregateBadge(info));
      if (packageId === this.selectedId) {
        this.selectedInfo = info;
      }
      return info;
    } catch {
      const fallback: PackageUpdateInfoDto = {
        id: packageId,
        verified: false,
        isMicrosoft: false,
        authors: "",
        tags: [],
        links: { nugetPage: `https://www.nuget.org/packages/${packageId}` },
        versions: [],
        fetchStatus: "Offline",
      };
      this.verdictBadges.set(packageId, "unknown");
      if (packageId === this.selectedId) {
        this.selectedInfo = fallback;
      }
      return fallback;
    }
  }

  private aggregateBadge(info: PackageUpdateInfoDto): string {
    if (info.fetchStatus !== "Ok" || !info.latestStable) {
      return "unknown";
    }
    const latest = info.versions.find((v) => v.version === info.latestStable);
    if (!latest) {
      return "unknown";
    }
    const verdicts = latest.verdictsByProject.map((p) => p.verdict);
    if (verdicts.some((v) => v === "Unknown")) {
      return "unknown";
    }
    if (verdicts.every((v) => v === "Compatible")) {
      return "ok";
    }
    if (verdicts.every((v) => v === "Incompatible")) {
      return "incompatible";
    }
    return "partial";
  }

  private onPackageSelected(e: CustomEvent<{ packageId: string }>): void {
    const changed = e.detail.packageId !== this.selectedId;
    this.selectedId = e.detail.packageId;
    // Reflète immédiatement le dernier état connu (cache de succès, sinon 'loading' via undefined) ;
    // loadUpdateInfo relance toujours un fetch Host si aucun succès n'est en cache pour ce package.
    this.selectedInfo = this.updateInfoCache.get(this.selectedId);
    void this.loadUpdateInfo(this.selectedId).then(() => this.requestUpdate());
    // Le résultat de la dernière écriture est attaché au package sur lequel elle a eu lieu : sans
    // ce reset, changer de sélection laisserait le bandeau 'skipped'/'error' d'un autre package
    // fuiter sur celui-ci (restoreStatus, lui, reste solution-wide et cohérent quelle que soit la
    // sélection — volontairement pas touché ici).
    if (changed) {
      this.lastWriteResult = undefined;
    }
  }

  /** Point d'entrée unique pour les 3 actions d'écriture, envoyées par ProjectInstallations
   *  (par projet) ou par la toolbar de PackageDetail (globale, projectPath absent). Les
   *  confirmations pour les actions globales sont gérées côté Host (modale) : ce composant se
   *  contente d'envoyer la commande et de rafraîchir l'état local une fois la réponse reçue. */
  private async onWriteCommand(
    kind: "install" | "upgrade" | "uninstall",
    detail: { projectPath?: string; version?: string },
  ): Promise<void> {
    if (!this.selectedId || !this.solutionPath) {
      return;
    }
    const { projectPath, version } = detail;
    const packageId = this.selectedId;
    const solutionPath = this.solutionPath;

    if (projectPath) {
      this.busyProjects = new Set(this.busyProjects).add(projectPath);
    } else {
      this.globalBusy = true;
    }

    try {
      const command =
        kind === "install"
          ? new InstallPackageCommand(packageId, version ?? "", solutionPath, projectPath)
          : kind === "upgrade"
            ? new UpgradePackageCommand(packageId, version ?? "", solutionPath, projectPath)
            : new UninstallPackageCommand(packageId, solutionPath, projectPath);
      this.lastWriteResult = (await this.dispatcher.Send(command)) as PackageWriteResultDto;
    } catch (error) {
      this.logger.Error(`Échec de l'action '${kind}' sur le package ${packageId}`, error as Error);
      this.lastWriteResult = {
        status: "Error",
        filesChanged: [],
        affectedProjects: [],
        skipped: [],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (projectPath) {
        const next = new Set(this.busyProjects);
        next.delete(projectPath);
        this.busyProjects = next;
      } else {
        this.globalBusy = false;
      }
    }

    // Recharge l'état solution-wide et le détail du package sélectionné : une écriture peut avoir
    // changé les installations, les versions effectives et les verdicts de compatibilité affichés.
    try {
      await this.loadPackages();
      this.updateInfoCache.delete(packageId);
      await this.loadUpdateInfo(packageId);
      // Nouvelle Map : déclenche le re-render du badge dans package-list (cf. fillBadges).
      this.verdictBadges = new Map(this.verdictBadges);
    } catch (error) {
      this.logger.Error("Échec du rechargement des packages après une écriture", error as Error);
    }

    this.startRestorePolling();
  }

  /** (Re)démarre le polling de `GetRestoreStatusQuery` après une commande d'écriture. La génération
   *  incrémentée invalide toute boucle précédente encore en vol : une nouvelle écriture pendant un
   *  polling en cours le réarme au lieu d'empiler un second intervalle, et un poll tardif d'une
   *  génération périmée devient un no-op silencieux. Le premier poll fixe le `runId` de référence :
   *  on ne s'arrête sur un état terminal (Succeeded/Failed) que si son `runId` est au moins celui-là
   *  — sans cette garde, un statut terminal laissé par un restore précédent (avant même que le
   *  nouveau restore programmé par cette écriture n'incrémente son runId) arrêterait le polling à
   *  tort. Filet de sécurité : arrêt forcé après RESTORE_POLL_TIMEOUT_MS (> timeout restore Host)
   *  quel que soit l'état — le bandeau bascule alors sur un état Failed dédié (Finding 4) plutôt que
   *  de rester figé sur un `Running` qui ne progressera plus jamais. Sur `Succeeded`, le statut est
   *  masqué après 4 s (sauf si entre-temps une écriture plus récente ou un nouveau statut a déjà pris
   *  sa place). */
  private startRestorePolling(): void {
    const generation = ++this.restorePollGeneration;
    if (this.restorePollTimer) {
      clearTimeout(this.restorePollTimer);
      this.restorePollTimer = undefined;
    }
    if (this.restoreHideTimer) {
      clearTimeout(this.restoreHideTimer);
      this.restoreHideTimer = undefined;
    }

    const deadline = Date.now() + PackagesView.RESTORE_POLL_TIMEOUT_MS;
    let baselineRunId: number | undefined;

    const poll = async (): Promise<void> => {
      if (generation !== this.restorePollGeneration) {
        return;
      }
      let status: RestoreStatusDto;
      try {
        status = (await this.dispatcher.Send(new GetRestoreStatusQuery())) as RestoreStatusDto;
      } catch (error) {
        this.logger.Error("Échec du polling du statut de restore", error as Error);
        return;
      }
      if (generation !== this.restorePollGeneration) {
        return;
      }
      this.restoreStatus = status;
      baselineRunId ??= status.runId;
      const terminal = status.status === "Succeeded" || status.status === "Failed";
      if (terminal && status.runId >= baselineRunId) {
        if (status.status === "Succeeded") {
          this.restoreHideTimer = setTimeout(() => {
            if (generation === this.restorePollGeneration && this.restoreStatus === status) {
              this.restoreStatus = undefined;
            }
          }, PackagesView.RESTORE_SUCCESS_HIDE_MS);
        }
        return;
      }
      if (Date.now() >= deadline) {
        // Le cap est atteint sans état terminal connu : ne jamais laisser le bandeau figé
        // sur 'Running' indéfiniment (Finding 4) — bascule vers un état Failed dédié.
        this.restoreStatus = {
          status: "Failed",
          messages: [this.i18n.t("packages.restore.timedOut")],
          runId: status.runId,
          finishedAtUtc: new Date().toISOString(),
        };
        return;
      }
      this.restorePollTimer = setTimeout(() => void poll(), PackagesView.RESTORE_POLL_INTERVAL_MS);
    };

    void poll();
  }

  render() {
    const selected = this.data?.packages.find((p) => p.id === this.selectedId);
    return html` <package-list
        .packages=${this.data?.packages ?? []}
        .verdictBadges=${this.verdictBadges}
        .uninterrogatedFeeds=${this.data?.uninterrogatedFeeds ?? []}
        .selectedId=${this.selectedId}
        style="width: ${this.listWidth}px"
        @package-selected=${this.onPackageSelected}
      ></package-list>
      <div
        class="splitter ${this.isResizing ? "dragging" : ""}"
        @pointerdown=${this.onSplitterPointerDown}
      ></div>
      ${
        selected
          ? html`<package-detail
              .package=${selected}
              .info=${this.selectedInfo}
              .busyProjects=${this.busyProjects}
              .globalBusy=${this.globalBusy}
              .restore=${this.restoreStatus}
              .writeResult=${this.lastWriteResult}
              @install-package=${(e: CustomEvent<{ projectPath?: string; version?: string }>) =>
                void this.onWriteCommand("install", e.detail)}
              @upgrade-package=${(e: CustomEvent<{ projectPath?: string; version?: string }>) =>
                void this.onWriteCommand("upgrade", e.detail)}
              @uninstall-package=${(e: CustomEvent<{ projectPath?: string }>) =>
                void this.onWriteCommand("uninstall", e.detail)}
            ></package-detail>`
          : html`<div class="detail-placeholder">${this.i18n.t("packages.noPackageSelected")}</div>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "packages-view": PackagesView;
  }
}
