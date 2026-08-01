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
import {
  type SolutionPackageDto,
  type SolutionPackagesDto,
} from "@Shared/Features/Dtos/SolutionPackagesDto";
import { type PackageUpdateInfoDto } from "@Shared/Features/Dtos/PackageUpdateInfoDto";
import {
  resolvePackageUpdateState,
  type PackageUpdateState,
} from "@Shared/Features/Packages/PackageUpdateState";
import { type PackageWriteResultDto } from "@Shared/Features/Dtos/PackageWriteResultDto";
import { type RestoreStatusDto } from "@Shared/Features/Dtos/RestoreStatusDto";
import { SearchPackagesQuery } from "@Shared/Features/Queries/SearchPackagesQuery";
import {
  type PackageSearchHitDto,
  type SearchResultsDto,
} from "@Shared/Features/Dtos/SearchResultsDto";
import { TranslationService } from "../../Core/Services/TranslationService";
import "./PackageList";
import "./PackageDetail";

@customElement("packages-view")
export class PackagesView extends LitElement {
  private static readonly BATCH_SIZE = 5;
  private static readonly RESTORE_POLL_INTERVAL_MS = 1_000;
  /** Must exceed the total Host-side budget (300 s restore, cf. RestoreScheduler.RESTORE_TIMEOUT_MS,
   *  + 60 s of dotnet nuget why enrichment on failure, cf. RestoreScheduler.WHY_TOTAL_BUDGET_MS,
   *  + margin) so polling is never cut before the Host has been able to publish its own
   *  terminal state (Finding 4). */
  private static readonly RESTORE_POLL_TIMEOUT_MS = 370_000;
  private static readonly RESTORE_SUCCESS_HIDE_MS = 4_000;

  @state() private data?: SolutionPackagesDto;
  @state() private selectedId = "";
  @state() private verdictBadges = new Map<string, PackageUpdateState>();
  /** Failed results (fetchStatus !== 'Ok') are deliberately absent from this cache: keeping them
   *  would freeze a synthetic 'Offline' DTO forever, preventing any retry. */
  protected readonly updateInfoCache = new Map<string, PackageUpdateInfoDto>();
  /** Last DTO received (success OR failure) for the currently selected package, used by the
   *  detail rendering. Transient by design: unlike updateInfoCache, it is never read to decide
   *  whether a fetch can be skipped — reselecting a failed package always restarts
   *  loadUpdateInfo. */
  @state() private selectedInfo?: PackageUpdateInfoDto;
  /** Projects with a write action in flight (Host has not answered yet) — relayed down to the
   *  ProjectInstallations cards to disable their buttons and show the spinner. */
  @state() private busyProjects = new Set<string>();
  /** A global action (PackageDetail toolbar, without projectPath) is in flight. */
  @state() private globalBusy = false;
  /** Last write result (success or failure): consumed by the banner (Task 11). */
  @state() private lastWriteResult?: PackageWriteResultDto;
  /** Last known restore status (polling started after each write), consumed by the
   *  banner. `undefined` until a write happens in the session, and again after the
   *  4 s auto-hide following a `Succeeded` (cf. `startRestorePolling`). */
  @state() private restoreStatus?: RestoreStatusDto;

  private static readonly SEARCH_PAGE_SIZE = 25;

  @state() private searchHits: PackageSearchHitDto[] = [];
  @state() private searchLoading = false;
  @state() private searchHasMore = false;
  @state() private searchFailedSources: string[] = [];
  /** The request itself did not complete (bus timeout, postMessage unavailable…),
   *  to be told apart from a search that completed with no result: without this dedicated
   *  state, an empty `searchHits` and an empty `searchFailedSources` would wrongly read as
   *  "no results" when in fact no source could be queried at all. */
  @state() private searchRequestFailed = false;
  private searchTerms = "";
  private searchPrerelease = false;
  /** Invalidates the answers of a stale search: only the latest keystroke counts. */
  private searchGeneration = 0;
  /** Current result page number (0 = first page). Reset to zero on every new search;
   *  incremented by `onLoadMore`. `skip` is ALWAYS derived from this counter, never
   *  from `searchHits.length` — the latter reflects the flow after client-side
   *  filtering and deduplication, which is offset from the raw pages each source
   *  actually served. */
  private searchPage = 0;

  private dispatcher!: IDispatcher;
  private logger!: ILogger;
  private i18n!: TranslationService;
  private unsubscribeI18n?: () => void;
  /** Incremented on every (re)start of the restore polling: invalidates any previous loop
   *  still in flight, guaranteeing only one runs at a time (a write during an ongoing poll
   *  re-arms it instead of stacking a second interval). */
  private restorePollGeneration = 0;
  private restorePollTimer?: ReturnType<typeof setTimeout>;
  private restoreHideTimer?: ReturnType<typeof setTimeout>;
  /** Resolved on connection through GetWorkspaceSolutionsQuery (the solution marked isSelected, otherwise the first one detected). */
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
    // Same discipline as the restore polling: a search in flight must not write
    // to the state of a disconnected element.
    this.searchGeneration++;
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

  /** Determines the active solution the same way as the rest of the extension: the solution marked `isSelected` (persisted in workspace settings through SelectSolutionCommand), falling back to the first one detected. */
  private async resolveSolutionPath(): Promise<void> {
    const solutions = (await this.dispatcher.Send(
      new GetWorkspaceSolutionsQuery(),
    )) as SolutionDto[];
    const solution = solutions.find((s) => s.isSelected) ?? solutions[0];
    if (!solution) {
      this.logger.Warning(
        "No solution detected in the workspace: the packages view will stay empty.",
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
      // New Map: triggers the re-render of package-list
      this.verdictBadges = new Map(this.verdictBadges);
      // HTTP 429: pause the queue rather than amplifying the throttling by chaining the
      // next batches. The remaining badges deliberately keep their default 'loading' state
      // (the '…' glyph) rather than a misleading 'unknown' — a reload or a reselection restarts the fetch.
      if (results.some((info) => info.fetchStatus === "RateLimited")) {
        this.logger.Warning("nuget.org is throttling requests (429): the badge queue is paused.");
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
      // Only cache successes: a cached failure DTO would freeze the status forever
      // and prevent any retry when the package is reselected.
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

  /** How much the installed package has left to gain (cf. `resolvePackageUpdateState`):
   *  without the package DTO — hence without its installed versions — the question
   *  "is there anything left to gain?" has no answer. */
  private aggregateBadge(info: PackageUpdateInfoDto): PackageUpdateState {
    const pkg = this.data?.packages.find((p) => p.id === info.id);
    if (!pkg) {
      return "unknown";
    }
    return resolvePackageUpdateState(pkg, info);
  }

  private onPackageSelected(e: CustomEvent<{ packageId: string }>): void {
    const changed = e.detail.packageId !== this.selectedId;
    this.selectedId = e.detail.packageId;
    // Immediately reflects the last known state (success cache, otherwise 'loading' through undefined);
    // loadUpdateInfo always restarts a Host fetch when no success is cached for this package.
    this.selectedInfo = this.updateInfoCache.get(this.selectedId);
    void this.loadUpdateInfo(this.selectedId).then(() => this.requestUpdate());
    // The last write result belongs to the package it happened on: without this reset,
    // changing selection would let another package's 'skipped'/'error' banner leak onto
    // this one (restoreStatus, by contrast, stays solution-wide and consistent whatever the
    // selection — deliberately untouched here).
    if (changed) {
      this.lastWriteResult = undefined;
    }
  }

  /** The field dropped back below the threshold: forget the previous results, or those
   *  of an abandoned search would reappear on the next keystroke. */
  private onSearchCleared(): void {
    this.searchGeneration++;
    this.searchTerms = "";
    this.searchPage = 0;
    this.searchHits = [];
    this.searchHasMore = false;
    this.searchFailedSources = [];
    this.searchRequestFailed = false;
    this.searchLoading = false;
  }

  private onSearchTermsChanged(terms: string, includePrerelease: boolean): void {
    this.searchTerms = terms;
    this.searchPrerelease = includePrerelease;
    this.searchHits = [];
    void this.runSearch(0);
  }

  private onLoadMore(): void {
    this.searchPage++;
    void this.runSearch(this.searchPage * PackagesView.SEARCH_PAGE_SIZE);
  }

  /** A stale generation is ignored on arrival: no late result overwrites those of a
   *  more recent keystroke. */
  private async runSearch(skip: number): Promise<void> {
    const generation = ++this.searchGeneration;
    // skip=0 always signals the start of a search (new terms, prerelease toggle):
    // the page counter restarts in step with it, whatever the caller —
    // onSearchTermsChanged or any future one.
    if (skip === 0) {
      this.searchPage = 0;
    }
    this.searchLoading = true;
    this.searchRequestFailed = false;
    try {
      const dto = (await this.dispatcher.Send(
        new SearchPackagesQuery(
          this.searchTerms,
          skip,
          PackagesView.SEARCH_PAGE_SIZE,
          this.searchPrerelease,
        ),
      )) as SearchResultsDto;
      if (generation !== this.searchGeneration) {
        return;
      }
      this.searchHits = skip === 0 ? dto.hits : [...this.searchHits, ...dto.hits];
      this.searchHasMore = dto.hasMore;
      this.searchFailedSources = dto.failedSources;
    } catch (error) {
      if (generation !== this.searchGeneration) {
        return;
      }
      this.logger.Error("Package search failed", error as Error);
      this.searchHasMore = false;
      // No source could be named (the whole request failed before querying them):
      // do not invent a source name in searchFailedSources, or the banner would
      // wrongly point at one specific source as responsible. The dedicated state
      // carries that distinction all the way to the rendering.
      this.searchRequestFailed = true;
    } finally {
      if (generation === this.searchGeneration) {
        this.searchLoading = false;
      }
    }
  }

  /**
   * Synthetic DTO for a search result: reuses the real installations when the
   * package is already in the solution, none otherwise. The detail panel and its
   * project cards then work without any modification.
   */
  private get selectedSearchPackage(): SolutionPackageDto | undefined {
    const hit = this.searchHits.find((h) => h.id.toLowerCase() === this.selectedId.toLowerCase());
    if (!hit) {
      return undefined;
    }
    const existing = this.data?.packages.find((p) => p.id.toLowerCase() === hit.id.toLowerCase());
    return {
      id: hit.id,
      iconUrl: hit.iconUrl ?? existing?.iconUrl ?? "",
      installations: existing?.installations ?? [],
    };
  }

  /** Single entry point for the 3 write actions, sent by ProjectInstallations
   *  (per project) or by the PackageDetail toolbar (global, projectPath absent).
   *  Confirmations for global actions are handled Host-side (modal): this component just
   *  sends the command and refreshes the local state once the answer comes back. */
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
      this.logger.Error(`Action '${kind}' failed on package ${packageId}`, error as Error);
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

    // Reloads the solution-wide state and the selected package detail: a write may have
    // changed the installations, the effective versions and the compatibility verdicts shown.
    try {
      await this.loadPackages();
      this.updateInfoCache.delete(packageId);
      await this.loadUpdateInfo(packageId);
      // New Map: triggers the badge re-render in package-list (cf. fillBadges).
      this.verdictBadges = new Map(this.verdictBadges);
    } catch (error) {
      this.logger.Error("Failed to reload the packages after a write", error as Error);
    }

    this.startRestorePolling();
  }

  /** (Re)starts the `GetRestoreStatusQuery` polling after a write command. The incremented
   *  generation invalidates any previous loop still in flight: a new write during an ongoing
   *  poll re-arms it instead of stacking a second interval, and a late poll from a stale
   *  generation becomes a silent no-op. The first poll fixes the reference `runId`:
   *  a terminal state (Succeeded/Failed) only stops the polling when its `runId` is at least
   *  that one — without this guard, a terminal status left by a previous restore (before the
   *  restore scheduled by this write has even incremented its runId) would wrongly stop the
   *  polling. Safety net: forced stop after RESTORE_POLL_TIMEOUT_MS (> Host restore timeout)
   *  whatever the state — the banner then switches to a dedicated Failed state (Finding 4)
   *  rather than staying frozen on a `Running` that will never progress again. On `Succeeded`,
   *  the status is hidden after 4 s (unless a more recent write or status has taken its place
   *  in the meantime). */
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
        this.logger.Error("Restore status polling failed", error as Error);
        return;
      }
      if (generation !== this.restorePollGeneration) {
        return;
      }
      this.restoreStatus = status;
      baselineRunId ??= status.runId;
      const terminal = status.status === "Succeeded" || status.status === "Failed";
      if (terminal && status.runId >= baselineRunId) {
        // The Logs tab (nuget-tabs) refreshes its list when a restore finishes.
        this.dispatchEvent(new CustomEvent("restore-finished", { bubbles: true, composed: true }));
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
        // The cap was reached with no known terminal state: never leave the banner frozen
        // on 'Running' indefinitely (Finding 4) — switch to a dedicated Failed state.
        // runId 0 (neutral) rather than status.runId: mid-run, the latter still designates
        // the PREVIOUS run (the scheduler only publishes the new one at the end), so a
        // "View logs →" click would highlight the wrong run. Journal runIds start at 1, so
        // revealRun(0) is a guaranteed no-op: we fall back on the specified behaviour
        // "runId absent → simply activate the tab".
        this.restoreStatus = {
          status: "Failed",
          messages: [this.i18n.t("packages.restore.timedOut")],
          runId: 0,
          finishedAtUtc: new Date().toISOString(),
        };
        return;
      }
      this.restorePollTimer = setTimeout(() => void poll(), PackagesView.RESTORE_POLL_INTERVAL_MS);
    };

    void poll();
  }

  render() {
    // A single list, two origins: a package from the solution wins over a remote
    // result with the same id — its real installations are the truth.
    const selected =
      this.data?.packages.find((p) => p.id === this.selectedId) ?? this.selectedSearchPackage;
    const feeds =
      this.searchFailedSources.length > 0
        ? [
            ...(this.data?.uninterrogatedFeeds ?? []),
            this.i18n.t("packages.list.failedSources", {
              names: this.searchFailedSources.join(", "),
            }),
          ]
        : (this.data?.uninterrogatedFeeds ?? []);
    return html` <package-list
        .packages=${this.data?.packages ?? []}
        .verdictBadges=${this.verdictBadges}
        .uninterrogatedFeeds=${feeds}
        .selectedId=${this.selectedId}
        .searchHits=${this.searchHits}
        .searchLoading=${this.searchLoading}
        .hasMore=${this.searchHasMore}
        .allSourcesFailed=${
          (this.searchRequestFailed || this.searchFailedSources.length > 0) &&
          this.searchHits.length === 0
        }
        style="width: ${this.listWidth}px"
        @package-selected=${this.onPackageSelected}
        @search-cleared=${() => this.onSearchCleared()}
        @search-terms-changed=${(e: CustomEvent<{ terms: string; includePrerelease: boolean }>) =>
          this.onSearchTermsChanged(e.detail.terms, e.detail.includePrerelease)}
        @load-more=${() => this.onLoadMore()}
      ></package-list>
      <div
        class="splitter ${this.isResizing ? "dragging" : ""}"
        @pointerdown=${this.onSplitterPointerDown}
      ></div>
      ${
        selected
          ? html`<package-detail
              .package=${selected}
              .projects=${this.data?.projects ?? []}
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
