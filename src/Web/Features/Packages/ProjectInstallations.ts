import { html, css, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { container } from "tsyringe";
import { type PackageInstallationDto } from "@Shared/Features/Dtos/SolutionPackagesDto";
import { type PackageVersionInfoDto } from "@Shared/Features/Dtos/PackageUpdateInfoDto";
import { TranslationService } from "../../Core/Services/TranslationService";
import {
  arrowUpIcon,
  checkIcon,
  crossIcon,
  ellipsisIcon,
  helpIcon,
  plusIcon,
  trashIcon,
} from "./Icons";

@customElement("project-installations")
export class ProjectInstallations extends LitElement {
  @property({ attribute: false }) installations: PackageInstallationDto[] = [];
  @property({ attribute: false }) selectedVersion?: PackageVersionInfoDto;

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
    .title {
      text-transform: uppercase;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin: 12px 0 8px;
    }
    .cards {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .card {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 9px 12px;
    }
    .name {
      font-weight: 600;
      font-size: 13px;
      flex: none;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border-radius: 10px;
      padding: 2px 8px;
      font-size: 11px;
      line-height: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .badge.Compatible {
      color: var(--vscode-charts-green);
      background: color-mix(in srgb, var(--vscode-charts-green) 16%, transparent);
    }
    .badge.Incompatible {
      color: var(--vscode-charts-red);
      background: color-mix(in srgb, var(--vscode-charts-red) 14%, transparent);
    }
    .badge.Unknown {
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-descriptionForeground) 12%, transparent);
    }
    .chip {
      flex: none;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 0 8px;
      font-size: 10.5px;
      line-height: 15px;
      color: var(--vscode-descriptionForeground);
    }
    .spacer {
      flex: 1;
    }
    button {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 5px 13px;
      border-radius: 5px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:disabled {
      opacity: 0.45;
    }
  `;

  private verdictBadge(projectPath: string): TemplateResult {
    const v = this.selectedVersion?.verdictsByProject.find((p) => p.projectPath === projectPath);
    if (!v) {
      return html`<span class="badge Unknown">${ellipsisIcon(12)}</span>`;
    }
    switch (v.verdict) {
      case "Compatible":
        return html`<span class="badge Compatible" title=${this.i18n.t("packages.list.verdictOk")}
          >${checkIcon(11)}</span
        >`;
      case "Incompatible":
        return html`<span class="badge Incompatible" title=${v.reason ?? ""}
          >${crossIcon(10)} ${v.reason ?? ""}</span
        >`;
      default:
        return html`<span class="badge Unknown" title=${v.reason ?? ""}>${helpIcon(12)}</span>`;
    }
  }

  render() {
    return html` <div class="title">
        ${this.i18n.t("packages.installations.title")} · ${this.installations.length}
      </div>
      <div class="cards">
        ${this.installations.map(
          (inst) =>
            html`<div class="card">
              <span class="name">${inst.projectName}</span>
              ${this.verdictBadge(inst.projectPath)}
              ${inst.effectiveTfms.map((tfm) => html`<span class="chip">${tfm}</span>`)}
              ${inst.installedVersion !== "unknown"
                ? html`<span class="chip">v ${inst.installedVersion}</span>`
                : nothing}
              <span class="spacer"></span>
              ${inst.referenceStyle === "PackagesConfig" || inst.installedVersion !== "unknown"
                ? html`<button
                      disabled
                      title=${this.i18n.t("packages.installations.comingSoonEpic5")}
                    >
                      ${arrowUpIcon(14)}
                    </button>
                    <button disabled title=${this.i18n.t("packages.installations.comingSoonEpic5")}>
                      ${trashIcon(14)}
                    </button>`
                : html`<button
                    disabled
                    title=${this.i18n.t("packages.installations.comingSoonEpic5")}
                  >
                    ${plusIcon(14)}
                  </button>`}
            </div>`,
        )}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "project-installations": ProjectInstallations;
  }
}
