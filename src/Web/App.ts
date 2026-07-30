import { html, css } from "lit";
import { customElement } from "lit/decorators.js";
import { BaseComponent } from "./Shared/Components/BaseComponent";
import { TranslationService } from "./Core/Services/TranslationService";
import { DISPATCHER, type IDispatcher } from "@Shared/Abstractions/Messaging/IDispatcher";
import { type ILogger, LOGGER } from "@/Host/Application/Abstractions/Log/ILogger";
import { container } from "tsyringe";
import "./Features/Shell/NugetTabs";

/**
 * Main App Component
 */
@customElement("nuget-app")
export class App extends BaseComponent {
  private i18n!: TranslationService;
  private dispatcher!: IDispatcher;
  private logger!: ILogger;
  private unsubscribe?: () => void;

  connectedCallback() {
    super.connectedCallback();

    this.i18n = this.resolve(TranslationService);
    this.dispatcher = container.resolve(DISPATCHER.toString()) as IDispatcher;
    this.logger = container.resolve<ILogger>(LOGGER.token);

    // Subscribe to language changes to trigger re-render
    this.i18n.subscribe(() => this.requestUpdate());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      width: 100%;
      overflow: hidden;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }

    /* min-height: 0 est indispensable ici : sans lui, un enfant flex refuse de
       descendre sous la taille de son contenu et aucune vue interne ne peut défiler. */
    .content {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }
  `;

  render() {
    return html`<div class="content"><nuget-tabs></nuget-tabs></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "nuget-app": App;
  }
}
