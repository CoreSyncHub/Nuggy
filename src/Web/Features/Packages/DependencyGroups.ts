import { html, css, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { container } from "tsyringe";
import { type DependencyGroupDto } from "@Shared/Features/Dtos/PackageUpdateInfoDto";
import { TranslationService } from "../../Core/Services/TranslationService";

@customElement("dependency-groups")
export class DependencyGroups extends LitElement {
  @property({ attribute: false }) groups: DependencyGroupDto[] = [];
  @property() version = "";

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
    details {
      margin-top: 10px;
    }
    summary {
      cursor: pointer;
      text-transform: uppercase;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .group {
      margin: 4px 0 4px 8px;
    }
    .tfm {
      font-weight: 600;
    }
    .dep {
      margin-left: 18px;
      color: var(--vscode-descriptionForeground);
    }
  `;

  render() {
    return html` <details>
      <summary>${this.i18n.t("packages.dependencies.title", { version: this.version })}</summary>
      ${this.groups.length === 0
        ? html`<div class="dep">${this.i18n.t("packages.dependencies.empty")}</div>`
        : this.groups.map(
            (g) =>
              html`<div class="group">
                <div class="tfm">
                  ${g.targetFramework || this.i18n.t("packages.dependencies.allFrameworks")}
                </div>
                ${g.dependencies.map((d) => html`<div class="dep">${d.id} ${d.versionRange}</div>`)}
              </div>`,
          )}
    </details>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dependency-groups": DependencyGroups;
  }
}
