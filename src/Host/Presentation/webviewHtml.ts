import * as vscode from 'vscode';

function getNonce(): string {
  let text = '';
  const possibleCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possibleCharacters.charAt(Math.floor(Math.random() * possibleCharacters.length));
  }
  return text;
}

export function getHtmlForWebview(extensionUri: vscode.Uri, webview: vscode.Webview): string {
  const i18nUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'i18n', 'locales')
  );
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const distUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist'));

  const nonce = getNonce();

  return `
<!DOCTYPE html>
<html lang="fr">
	<head>
		<meta charset="UTF-8" />
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}' ${webview.cspSource}; connect-src ${webview.cspSource} https: ws://localhost:35729 ws://localhost:5173; style-src ${webview.cspSource} 'unsafe-inline';">
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>NuGet Explorer</title>
	</head>
	<body>
		<div id="app">
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

declare global {
  interface Window {
    __I18N_URI__?: string;
    __DIST_URI__?: string;
  }
}
