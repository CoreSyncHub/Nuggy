import { html, css, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { container } from "tsyringe";
import {
  type PackageUpdateInfoDto,
  type PackageVersionInfoDto,
} from "@Shared/Features/Dtos/PackageUpdateInfoDto";
import {
  type PackageInstallationDto,
  type SolutionPackageDto,
  type SolutionProjectDto,
} from "@Shared/Features/Dtos/SolutionPackagesDto";
import { type RestoreStatusDto } from "@Shared/Features/Dtos/RestoreStatusDto";
import { type PackageWriteResultDto } from "@Shared/Features/Dtos/PackageWriteResultDto";
import { TranslationService } from "../../Core/Services/TranslationService";
import { defaultPackageIcon } from "./DefaultPackageIcon";
import { verifiedBadgeIcon, VERIFIED_BLUE, MICROSOFT_PURPLE } from "./VerifiedBadgeIcon";
import {
  arrowUpIcon,
  downloadIcon,
  ellipsisIcon,
  globeIcon,
  licenseIcon,
  plusIcon,
  trashIcon,
} from "./Icons";
import { writeActionStyles } from "./WriteActionStyles";
import { formatCount, formatDate } from "../../Shared/Utils/Formatting";
import "./DependencyGroups";
import "./ProjectInstallations";
import "./WriteStatusBanner";

@customElement("package-detail")
export class PackageDetail extends LitElement {
  @property({ attribute: false }) package!: SolutionPackageDto;
  /** Every project in the solution: merged with the installations so unequipped
   *  projects — and therefore their install button — are rendered, cf. `allInstallations`. */
  @property({ attribute: false }) projects: SolutionProjectDto[] = [];
  @property({ attribute: false }) info?: PackageUpdateInfoDto;
  /** Busy project paths (relayed as is to project-installations). */
  @property({ attribute: false }) busyProjects: Set<string> = new Set();
  /** A global action (toolbar, without projectPath) is in flight: disables the 3 global buttons. */
  @property({ attribute: false }) globalBusy = false;
  /** Status of the last `dotnet restore` (polling handled by PackagesView), relayed as is to the banner. */
  @property({ attribute: false }) restore?: RestoreStatusDto;
  /** Last write result (success or failure), relayed as is to the banner. */
  @property({ attribute: false }) writeResult?: PackageWriteResultDto;
  @state() private selectedVersion = "";
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

  /** The selected version and the prerelease filter only make sense for the package on screen:
   *  without this reset, changing selection in the list would let those states "leak" onto the new
   *  package (e.g. a version picked on X that does not exist for Y, or a prerelease filter left
   *  ticked). We only reset when the package identity actually changes — not on every re-render
   *  triggered by the asynchronous arrival of `.info` for the same package. */
  protected willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("package")) {
      return;
    }
    const previous = changed.get("package");
    if (previous && previous.id !== this.package.id) {
      this.selectedVersion = "";
      this.showPrereleases = false;
      this.iconFailed = false;
    }
  }

  static styles = [
    writeActionStyles,
    css`
      :host {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }
      /* The icon (64 px) sets the header height: the identity distributes itself
       vertically against it, while the controls live in a dedicated full-width
       strip underneath (VS Code toolbar pattern). */
      .header {
        display: flex;
        gap: 14px;
        height: 64px;
        padding: 14px 14px 10px;
      }
      img.big-icon,
      .header svg.default-icon {
        width: 64px;
        height: 64px;
        border-radius: 10px;
        flex: none;
      }
      .identity {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 2px 0;
      }
      .name-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .name {
        font-size: 16px;
        font-weight: 600;
      }
      .name-row svg {
        flex: none;
      }
      .meta {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }
      .links-tags {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        white-space: nowrap;
        overflow: hidden;
      }
      .links-tags a {
        color: var(--vscode-textLink-foreground);
        display: inline-flex;
        align-items: center;
        gap: 3px;
        flex: none;
      }
      .tag {
        flex: none;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 9px;
        padding: 0 8px;
        font-size: 10px;
        line-height: 14px;
      }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 14px;
        margin-top: 6px;
        background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
        border-top: 1px solid var(--vscode-panel-border);
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      select,
      button {
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        padding: 2px 10px;
      }
      .spacer {
        flex: 1;
      }
      button.global {
        font-size: 14px;
      }
      button:disabled {
        opacity: 0.45;
      }
      label.prerelease {
        font-size: 11px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .body {
        padding: 0 14px 14px;
      }
      .status {
        color: var(--vscode-descriptionForeground);
        padding: 14px;
      }
    `,
  ];

  private get installedIsPrerelease(): boolean {
    return this.package.installations.some((i) => i.installedVersion.includes("-"));
  }

  /**
   * The three global actions only make sense when the package is already somewhere
   * in the solution: nothing to update nor to remove otherwise, and adding a
   * dependency to EVERY project at once is rarely the intent — that is undone
   * project by project. A package found through search is therefore installed from
   * the project cards, one target at a time.
   */
  private get isInstalledSomewhere(): boolean {
    return this.package.installations.length > 0;
  }

  /**
   * Real installations, followed by the solution's projects that do not have the
   * package (marked `installedVersion: "unknown"`, which `project-installations`
   * already renders as "installable"). Each group stays sorted by project name;
   * equipped projects first, so the useful information stays on top.
   */
  private get allInstallations(): PackageInstallationDto[] {
    const installed = this.package.installations;
    const installedPaths = new Set(installed.map((i) => i.projectPath));
    const candidates: PackageInstallationDto[] = this.projects
      .filter((p) => !installedPaths.has(p.projectPath))
      .map((p) => ({
        projectPath: p.projectPath,
        projectName: p.projectName,
        effectiveTfms: p.effectiveTfms,
        installedVersion: "unknown",
        referenceStyle: p.referenceStyle,
      }));
    return [...installed, ...candidates];
  }

  private get visibleVersions(): PackageVersionInfoDto[] {
    const all = this.info?.versions ?? [];
    if (this.showPrereleases || this.installedIsPrerelease) {
      return all;
    }
    return all.filter((v) => !v.isPrerelease);
  }

  private get currentVersion(): PackageVersionInfoDto | undefined {
    const versions = this.visibleVersions;
    return versions.find((v) => v.version === this.selectedVersion) ?? versions[0];
  }

  /** Emits a global write event (bubbles+composed, like package-selected): the
   *  confirmation for an "everywhere" action happens Host-side — this component just sends.
   *  Without a projectPath, PackagesView.onWriteCommand knows it is a global action. */
  private dispatchWrite(
    type: "install-package" | "upgrade-package" | "uninstall-package",
    version?: string,
  ): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail: { version }, bubbles: true, composed: true }),
    );
  }

  render() {
    if (!this.info) {
      return html`<div class="status">${this.i18n.t("packages.detail.loading")}</div>`;
    }
    if (this.info.fetchStatus !== "Ok") {
      const message = {
        Offline: this.i18n.t("packages.detail.fetchStatus.offline"),
        NotFound: this.i18n.t("packages.detail.fetchStatus.notFound"),
        RateLimited: this.i18n.t("packages.detail.fetchStatus.rateLimited"),
      }[this.info.fetchStatus];
      return html`<div class="status">${message}</div>`;
    }

    const current = this.currentVersion;
    const language = this.i18n.getCurrentLanguage();
    const published = formatDate(this.info.publishedUtc, language) || undefined;
    const downloads = formatCount(this.info.totalDownloads, language) || undefined;

    return html` <div class="header">
        ${
          this.iconFailed
            ? defaultPackageIcon(64)
            : html`<img
                class="big-icon"
                src=${this.package.iconUrl}
                @error=${() => (this.iconFailed = true)}
              />`
        }
        <div class="identity">
          <div class="name-row">
            <span class="name">${this.info.id}</span>
            ${
              this.info.isMicrosoft
                ? verifiedBadgeIcon(
                    MICROSOFT_PURPLE,
                    18,
                    this.i18n.t("packages.detail.microsoftTooltip"),
                  )
                : this.info.verified
                  ? verifiedBadgeIcon(
                      VERIFIED_BLUE,
                      18,
                      this.i18n.t("packages.detail.verifiedTooltip"),
                    )
                  : nothing
            }
          </div>
          <div class="meta">
            ${this.i18n.t("packages.detail.byAuthor", { author: this.info.authors })}${
              published ? html` · ${published}` : nothing
            }${downloads ? html` · ${downloadIcon(11)} ${downloads}` : nothing}
          </div>
          <div class="links-tags">
            <a href=${this.info.links.nugetPage}>${defaultPackageIcon(11)} nuget.org</a>
            ${
              this.info.links.projectSite
                ? html`<a href=${this.info.links.projectSite}
                    >${globeIcon(11)} ${this.i18n.t("packages.detail.projectSiteLink")}</a
                  >`
                : nothing
            }
            ${
              this.info.links.license?.url
                ? html`<a href=${this.info.links.license.url}
                    >${licenseIcon(11)}
                    ${this.info.links.license.expression ?? this.i18n.t("packages.detail.license")}</a
                  >`
                : nothing
            }
            ${this.info.tags.map((t) => html`<span class="tag">${t}</span>`)}
          </div>
        </div>
      </div>
      <div class="toolbar">
        <select
          @change=${(e: Event) => (this.selectedVersion = (e.target as HTMLSelectElement).value)}
        >
          ${this.visibleVersions.map(
            (v) =>
              html`<option value=${v.version} ?selected=${v.version === current?.version}>
                v ${v.version}
              </option>`,
          )}
        </select>
        <select disabled title=${this.i18n.t("packages.detail.sourceComingSoon")}>
          <option>nuget.org</option>
        </select>
        <label class="prerelease">
          <input
            type="checkbox"
            .checked=${this.showPrereleases}
            ?disabled=${this.installedIsPrerelease}
            @change=${(e: Event) => (this.showPrereleases = (e.target as HTMLInputElement).checked)}
          />
          ${this.i18n.t("packages.detail.prereleaseLabel")}
        </label>
        <span class="spacer"></span>
        ${
          !this.isInstalledSomewhere
            ? nothing
            : html`<button
                class="global install"
                ?disabled=${this.globalBusy || !current}
                title=${this.i18n.t("packages.detail.installEverywhere")}
                @click=${() => this.dispatchWrite("install-package", current?.version)}
              >
                ${this.globalBusy ? ellipsisIcon(14) : plusIcon(14)}
              </button>`
        }
        ${
          !this.isInstalledSomewhere
            ? nothing
            : html`<button
                class="global upgrade"
                ?disabled=${this.globalBusy || !current}
                title=${this.i18n.t("packages.detail.updateAllEverywhere")}
                @click=${() => this.dispatchWrite("upgrade-package", current?.version)}
              >
                ${this.globalBusy ? ellipsisIcon(14) : arrowUpIcon(14)}
              </button>`
        }
        ${
          !this.isInstalledSomewhere
            ? nothing
            : html`<button
                class="global uninstall"
                ?disabled=${this.globalBusy}
                title=${this.i18n.t("packages.detail.uninstallEverywhere")}
                @click=${() => this.dispatchWrite("uninstall-package")}
              >
                ${this.globalBusy ? ellipsisIcon(14) : trashIcon(14)}
              </button>`
        }
      </div>
      <write-status-banner
        .restore=${this.restore}
        .writeResult=${this.writeResult}
      ></write-status-banner>
      <div class="body">
        ${
          current
            ? html`<project-installations
                  .installations=${this.allInstallations}
                  .selectedVersion=${current}
                  .busyProjects=${this.busyProjects}
                ></project-installations>
                <dependency-groups
                  .groups=${current.dependencyGroups}
                  .version=${current.version}
                ></dependency-groups>`
            : nothing
        }
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "package-detail": PackageDetail;
  }
}
