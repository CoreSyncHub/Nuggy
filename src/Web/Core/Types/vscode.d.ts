/**
 * Type definitions for VSCode WebView API.
 * This API is injected by VSCode into the WebView context.
 */

export interface VsCodeApi {
  /**
   * Post a message to the extension host.
   * @param message The message to send
   */
  postMessage(message: unknown): void;

  /**
   * Get the persistent state for this webview.
   */
  getState(): unknown;

  /**
   * Set the persistent state for this webview.
   * @param newState The new state
   */
  setState(newState: unknown): void;
}

declare global {
  interface Window {
    /**
     * Acquire the VSCode API instance (can only be called once per webview).
     */
    acquireVsCodeApi?: () => VsCodeApi;

    /**
     * Cached VSCode API instance (set after first acquireVsCodeApi call).
     */
    vscode?: VsCodeApi;
  }
}

export {};
