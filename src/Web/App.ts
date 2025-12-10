import { html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { BaseComponent } from './Shared/Components/BaseComponent';
import { TranslationService } from './Core/Services/TranslationService';
import { DISPATCHER, IDispatcher } from '@Shared/Abstractions/Messaging/IDispatcher';
import { ILogger, LOGGER } from '@/Host/Application/Abstractions/Log/ILogger';
import { container } from 'tsyringe';

/**
 * Main App Component
 */
@customElement('nuget-app')
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

    .header {
      display: flex;
      flex-direction: column;
      padding: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background-color: var(--vscode-sideBar-background);
    }

    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 12px;
    }

    .tab {
      flex: 1;
      padding: 8px 16px;
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }

    .tab:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .tab.active {
      border-bottom-color: var(--vscode-focusBorder);
      font-weight: 600;
    }

    .search-box {
      position: static;
    }

    .search-box input {
      width: 100%;
      padding: 8px 12px;
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px;
      outline: none;
    }

    .search-box input:focus {
      border-color: var(--vscode-focusBorder);
    }

    .content {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .list-content {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 40%;
      border-right: 1px solid var(--vscode-panel-border);
    }

    .list-panel {
      width: 100%;
      border-right: 1px solid var(--vscode-panel-border);
      overflow: hidden;
    }

    .details-panel {
      flex: 1;
      overflow: hidden;
    }

    .loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
  `;

  render() {
    return html` <div class="content"></div> `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'nuget-app': App;
  }
}
