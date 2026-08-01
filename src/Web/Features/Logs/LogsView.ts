import { html, css, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { container } from "tsyringe";
import { DISPATCHER, type IDispatcher } from "@Shared/Abstractions/Messaging/IDispatcher";
import { type ILogger, LOGGER } from "@/Host/Application/Abstractions/Log/ILogger";
import { GetOperationLogQuery } from "@Shared/Features/Queries/GetOperationLogQuery";
import {
  type OperationLogDto,
  type OperationLogEntryDto,
  type RestoreRunEntryDto,
  type WriteOperationEntryDto,
} from "@Shared/Features/Dtos/OperationLogDto";
import { TranslationService } from "../../Core/Services/TranslationService";
import {
  arrowUpIcon,
  checkIcon,
  crossIcon,
  ellipsisIcon,
  plusIcon,
  trashIcon,
  warningIcon,
} from "../Packages/Icons";

/**
 * Logs tab: newest-first session journal (restore runs with their full,
 * collapsible output plus write operations). Fetches on every activation and on
 * every `refreshToken` (restore completion observed by packages-view's polling)
 * — never polls on its own.
 */
@customElement("logs-view")
export class LogsView extends LitElement {
  /** The Logs tab is currently active (supplied by nuget-tabs). */
  @property({ type: Boolean }) active = false;
  /** Incremented by nuget-tabs on every restore completion: triggers a re-fetch when active. */
  @property({ type: Number }) refreshToken = 0;
  /** runId of the restore run to expand and scroll to (navigation from the failure banner). */
  @property({ type: Number }) targetRunId?: number;

  @state() private entries: OperationLogEntryDto[] = [];
  /** Restore cards currently expanded (keyed by runId) — preserved across re-fetches. */
  @state() private expandedRuns = new Set<number>();
  @state() private highlightedRunId?: number;

  private dispatcher!: IDispatcher;
  private logger!: ILogger;
  private i18n!: TranslationService;
  private unsubscribeI18n?: () => void;
  private highlightTimer?: ReturnType<typeof setTimeout>;

  connectedCallback(): void {
    super.connectedCallback();
    this.dispatcher = container.resolve<IDispatcher>(DISPATCHER.token);
    this.logger = container.resolve<ILogger>(LOGGER.token);
    this.i18n = container.resolve(TranslationService);
    this.unsubscribeI18n = this.i18n.subscribe(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribeI18n?.();
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
  }

  protected updated(changed: PropertyValues<this>): void {
    const becameActive = changed.has("active") && this.active;
    const refreshed = changed.has("refreshToken") && this.active;
    const retargeted = changed.has("targetRunId") && this.targetRunId !== undefined;
    if (becameActive || refreshed || retargeted) {
      void this.load().then(() => {
        if (this.targetRunId !== undefined) {
          this.revealRun(this.targetRunId);
        }
      });
    }
  }

  private async load(): Promise<void> {
    try {
      const dto = (await this.dispatcher.Send(new GetOperationLogQuery())) as OperationLogDto;
      this.entries = dto.entries;
    } catch (error) {
      this.logger.Error("Failed to load the operation journal", error as Error);
    }
  }

  /** Expands, scrolls to and briefly highlights the run card. runId absent from the buffer → no-op. */
  private revealRun(runId: number): void {
    if (!this.entries.some((e) => e.kind === "restore" && e.runId === runId)) {
      return;
    }
    this.expandedRuns = new Set(this.expandedRuns).add(runId);
    this.highlightedRunId = runId;
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
    }
    this.highlightTimer = setTimeout(() => (this.highlightedRunId = undefined), 2_000);
    void this.updateComplete.then(() => {
      this.shadowRoot
        ?.querySelector(`[data-run-id="${runId}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  private toggleRun(runId: number, e: Event): void {
    e.preventDefault();
    const next = new Set(this.expandedRuns);
    if (next.has(runId)) {
      next.delete(runId);
    } else {
      next.add(runId);
    }
    this.expandedRuns = next;
  }

  static styles = css`
    :host {
      display: block;
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      font-size: 12px;
      color: var(--vscode-foreground);
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding: 24px 0;
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 8px;
      transition: background 0.3s;
    }
    .card.highlighted {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--vscode-focusBorder);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .head svg {
      flex: none;
    }
    .head .when {
      margin-left: auto;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .meta {
      color: var(--vscode-descriptionForeground);
    }
    .succeeded {
      color: var(--vscode-charts-green);
    }
    .failed {
      color: var(--vscode-charts-red);
    }
    .running {
      color: var(--vscode-descriptionForeground);
    }
    summary {
      cursor: pointer;
      list-style: none;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    .output {
      margin: 6px 0 0 20px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 320px;
      overflow-y: auto;
    }
    .why-title {
      margin: 6px 0 0 20px;
      font-weight: 600;
    }
    .sub {
      margin: 4px 0 0 20px;
    }
  `;

  private formatWhen(iso: string): string {
    return new Date(iso).toLocaleTimeString("fr-FR");
  }

  private renderRestore(entry: RestoreRunEntryDto) {
    const t = this.i18n;
    const statusIcon =
      entry.status === "Succeeded"
        ? checkIcon(14)
        : entry.status === "Failed"
          ? crossIcon(14)
          : ellipsisIcon(14);
    const duration =
      entry.finishedUtc !== undefined
        ? t.t("logs.durationSeconds", {
            seconds: Math.round(
              (new Date(entry.finishedUtc).getTime() - new Date(entry.startedUtc).getTime()) / 1000,
            ),
          })
        : t.t("logs.running");
    // Windows paths are possible in real use: split on both separators rather than "/" alone.
    const solutionName = entry.solutionPath.split(/[\\/]/).pop() ?? entry.solutionPath;
    const expanded = this.expandedRuns.has(entry.runId);
    return html`<div
      class="card ${this.highlightedRunId === entry.runId ? "highlighted" : ""}"
      data-run-id=${entry.runId}
    >
      <details ?open=${expanded}>
        <summary
          class="head ${entry.status.toLowerCase()}"
          @click=${(e: Event) => this.toggleRun(entry.runId, e)}
        >
          ${statusIcon} ${t.t("logs.restoreTitle", { solution: solutionName })}
          <span class="meta"
            >${duration}${
              entry.exitCode !== undefined
                ? html` · ${t.t("logs.exitCode", { code: entry.exitCode })}`
                : nothing
            }</span
          >
          <span class="when">${this.formatWhen(entry.startedUtc)}</span>
        </summary>
        ${
          entry.whyInsights.length > 0
            ? html`<div class="why-title">${t.t("logs.whyTitle")}</div>
                <div class="output">${entry.whyInsights.join("\n")}</div>`
            : nothing
        }
        <div class="output">${entry.output.join("\n")}</div>
      </details>
    </div>`;
  }

  private renderWrite(entry: WriteOperationEntryDto) {
    const t = this.i18n;
    const opIcon =
      entry.operation === "install"
        ? plusIcon(14)
        : entry.operation === "upgrade"
          ? arrowUpIcon(14)
          : trashIcon(14);
    const statusIcon = entry.status === "Ok" ? checkIcon(14) : crossIcon(14);
    return html`<div class="card">
      <details>
        <summary class="head ${entry.status === "Ok" ? "succeeded" : "failed"}">
          ${opIcon} ${t.t(`logs.operation.${entry.operation}`)} —
          ${entry.packageId}${entry.version !== undefined ? html`@${entry.version}` : nothing}
          ${statusIcon}
          <span class="meta"
            >${t.t("logs.affectedProjects", { count: entry.affectedProjects.length })}</span
          >
          <span class="when">${this.formatWhen(entry.timestampUtc)}</span>
        </summary>
        ${entry.error !== undefined ? html`<div class="sub failed">${entry.error}</div>` : nothing}
        ${
          entry.filesChanged.length > 0
            ? html`<div class="sub">
                <strong>${t.t("logs.filesChanged")}</strong> :
                ${entry.filesChanged.map((f) => html`<div>${f}</div>`)}
              </div>`
            : nothing
        }
        ${
          entry.skipped.length > 0
            ? html`<div class="sub">
                <strong>${t.t("logs.skipped")}</strong> :
                ${entry.skipped.map(
                  (s) => html`<div>${warningIcon(11)} ${s.path} — ${s.reason}</div>`,
                )}
              </div>`
            : nothing
        }
      </details>
    </div>`;
  }

  render() {
    if (this.entries.length === 0) {
      return html`<div class="empty">${this.i18n.t("logs.empty")}</div>`;
    }
    return html`${repeat(
      this.entries,
      (e) =>
        e.kind === "restore" ? `r${e.runId}` : `w${e.timestampUtc}|${e.operation}|${e.packageId}`,
      (e) => (e.kind === "restore" ? this.renderRestore(e) : this.renderWrite(e)),
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "logs-view": LogsView;
  }
}
