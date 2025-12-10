import { html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { LitElement } from 'lit';

/**
 * Loading Spinner Component
 * Displays a VSCode progress ring with optional message.
 */
@customElement('loading-spinner')
export class LoadingSpinner extends LitElement {
  @property({ type: String }) message = '';

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .message {
      font-size: 13px;
    }
  `;

  render() {
    return html`
      <fluent-progress-ring></fluent-progress-ring>
      ${this.message ? html`<div class="message">${this.message}</div>` : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'loading-spinner': LoadingSpinner;
  }
}
