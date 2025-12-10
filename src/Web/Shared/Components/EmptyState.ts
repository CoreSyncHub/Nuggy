import { html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { LitElement } from 'lit';

/**
 * Empty State Component
 * Displays a message when there's no content to show.
 */
@customElement('empty-state')
export class EmptyState extends LitElement {
  @property({ type: String }) message = '';
  @property({ type: String }) icon = 'ℹ️';

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 40px 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }

    .icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .message {
      font-size: 14px;
      max-width: 300px;
    }
  `;

  render() {
    return html`
      <div class="icon">${this.icon}</div>
      <div class="message">${this.message}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'empty-state': EmptyState;
  }
}
