import * as vscode from 'vscode';

export function getHtmlForWebview(extensionUri: vscode.Uri, webview: vscode.Webview): string {
  const i18nUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'i18n', 'locales')
  );
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const distUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist'));

  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="fr">
<head>
	<meta charset="UTF-8" />
 	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}' ${webview.cspSource}; connect-src ${webview.cspSource} https: ws://localhost:35729 ws://localhost:5173; style-src ${webview.cspSource} 'unsafe-inline';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>NuGet Explorer</title>
	<style>
		* {
			box-sizing: border-box;
		}

		body {
			padding: 0;
			margin: 0;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-panel-background);
			height: 100vh;
			overflow: hidden;
		}
		
		#app {
			height: 100%;
		}

		/* 2-Column Layout */
		.layout {
			display: flex;
			height: 100%;
		}

		.left-panel {
			width: 320px;
			min-width: 200px;
			max-width: 600px;
			display: flex;
			flex-direction: column;
			background: var(--vscode-sideBar-background);
			flex-shrink: 0;
		}

		.resize-handle {
			width: 4px;
			background: var(--vscode-panel-border);
			cursor: col-resize;
			flex-shrink: 0;
			transition: background 0.15s ease;
		}

		.resize-handle:hover {
			background: var(--vscode-focusBorder);
		}

		.right-panel {
			flex: 1;
			overflow-y: auto;
			padding: 16px;
			background: var(--vscode-editor-background);
			min-width: 200px;
		}

		/* Header */
		.header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 12px 16px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.header h1 {
			margin: 0;
			font-size: 1.1em;
			font-weight: 600;
		}

		.header-actions {
			display: flex;
			gap: 8px;
			align-items: center;
		}

		.cpm-badge {
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			padding: 2px 8px;
			border-radius: 10px;
			font-size: 0.7em;
			font-weight: 600;
		}

		/* Tabs */
		.tabs {
			display: flex;
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.tab-btn {
			flex: 1;
			padding: 10px 16px;
			background: transparent;
			border: none;
			border-bottom: 2px solid transparent;
			color: var(--vscode-foreground);
			cursor: pointer;
			font-size: 0.9em;
			transition: all 0.15s ease;
		}

		.tab-btn:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.tab-btn.active {
			border-bottom-color: var(--vscode-focusBorder);
			color: var(--vscode-foreground);
			font-weight: 500;
		}

		/* Search */
		.search-container {
			padding: 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.search-container fluent-text-field {
			width: 100%;
		}

		/* Package List */
		.package-list {
			flex: 1;
			overflow-y: auto;
		}

		.packages {
			display: flex;
			flex-direction: column;
		}

		.package-row {
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 10px 16px;
			cursor: pointer;
			border-bottom: 1px solid var(--vscode-list-hoverBackground);
			transition: background 0.1s ease;
		}

		.package-row:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.package-row.selected {
			background: var(--vscode-list-activeSelectionBackground);
			color: var(--vscode-list-activeSelectionForeground);
		}

		.package-row.has-update {
			border-left: 3px solid var(--vscode-notificationsInfoIcon-foreground);
		}

		.package-icon {
			width: 28px;
			height: 28px;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 20px;
		}

		.package-icon img {
			width: 100%;
			height: 100%;
			border-radius: 4px;
			object-fit: contain;
		}

		.package-main {
			flex: 1;
			min-width: 0;
		}

		.package-name {
			font-weight: 500;
			font-size: 0.9em;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.package-version {
			font-size: 0.75em;
			color: var(--vscode-descriptionForeground);
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.update-badge {
			background: var(--vscode-notificationsInfoIcon-foreground);
			color: white;
			padding: 1px 6px;
			border-radius: 8px;
			font-size: 0.85em;
		}

		.quick-update-btn {
			opacity: 0.7;
		}

		.quick-update-btn:hover {
			opacity: 1;
		}

		/* Update Bar */
		.update-bar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 8px 16px;
			background: var(--vscode-editorInfo-background);
			border-bottom: 1px solid var(--vscode-panel-border);
			font-size: 0.85em;
		}

		/* Loading & Empty States */
		.loading-container {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			padding: 32px;
			gap: 16px;
		}

		.empty-state {
			text-align: center;
			padding: 32px 16px;
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
		}

		/* Package Details (Right Panel) */
		.package-details {
			max-width: 600px;
		}

		.details-header {
			display: flex;
			align-items: flex-start;
			gap: 16px;
			margin-bottom: 24px;
		}

		.details-icon {
			width: 48px;
			height: 48px;
			font-size: 36px;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.details-icon img {
			width: 100%;
			height: 100%;
			border-radius: 6px;
			object-fit: contain;
		}

		.details-title h2 {
			margin: 0 0 4px 0;
			font-size: 1.3em;
		}

		.installed-version {
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			padding: 2px 8px;
			border-radius: 4px;
			font-size: 0.8em;
		}

		.details-section {
			margin-bottom: 20px;
		}

		.details-section label {
			display: block;
			font-weight: 600;
			margin-bottom: 8px;
			font-size: 0.85em;
			color: var(--vscode-descriptionForeground);
			text-transform: uppercase;
			letter-spacing: 0.5px;
		}

		.description {
			margin: 0;
			font-size: 0.9em;
			line-height: 1.5;
			color: var(--vscode-foreground);
		}

		.version-selector {
			display: flex;
			align-items: center;
			gap: 12px;
		}

		.version-selector fluent-select {
			min-width: 150px;
		}

		/* Project List in Details */
		.project-list {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.project-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 8px 12px;
			background: var(--vscode-list-hoverBackground);
			border-radius: 4px;
		}

		.project-info {
			display: flex;
			align-items: center;
			gap: 8px;
		}

		.project-icon {
			font-size: 14px;
		}

		.project-name {
			font-size: 0.9em;
		}

		.install-status {
			cursor: pointer;
			font-size: 16px;
			padding: 4px;
			border-radius: 4px;
			transition: background 0.1s ease;
		}

		.install-status:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.install-project-btn {
			font-size: 14px;
		}

		.link {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
		}

		.link:hover {
			text-decoration: underline;
		}
	</style>
</head>
<body>
	<div id="app">
		<div class="loading-container">
			<fluent-progress-ring></fluent-progress-ring>
			<p>Chargement...</p>
		</div>
	</div>
	<script nonce="${nonce}">
		// Expose URIs to the webview script
		window.__I18N_URI__ = "${i18nUri}";
		window.__DIST_URI__ = "${distUri}";
	</script>
	<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possibleCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possibleCharacters.charAt(Math.floor(Math.random() * possibleCharacters.length));
  }
  return text;
}

declare global {
  interface Window {
    __I18N_URI__?: string;
    __DIST_URI__?: string;
  }
}
