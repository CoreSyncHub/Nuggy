// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import 'reflect-metadata';
import { NuGetWebviewProvider } from './nugetWebviewProvider';
import { ApplicationDependencyInjection } from '../Application/DependencyInjection';
import { InfrastructureDependencyInjection } from '../Infrastructure/DependencyInjection';
import { VscLogger } from '../Infrastructure/Log/VscLogger';

/**
 * Active l'extension et enregistre le WebviewViewProvider pour la vue contribuée dans le panel.
 * @param context Contexte d'extension fourni par VS Code.
 */
export function activate(context: vscode.ExtensionContext) {
  const applicationDi = new ApplicationDependencyInjection();
  const infrastructureDi = new InfrastructureDependencyInjection();
  applicationDi.Provide();
  infrastructureDi.Provide();

  // Register the provider of webview for the panel NuGet
  // NuGetWebviewProvider now uses DI container for all dependencies
  const nugetProvider = new NuGetWebviewProvider(context.extensionUri);
  const providerDisposable = vscode.window.registerWebviewViewProvider(
    NuGetWebviewProvider.viewType,
    nugetProvider,
    {
      webviewOptions: { retainContextWhenHidden: true },
    }
  );
  context.subscriptions.push(providerDisposable);

  // Listen for language configuration changes
  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('nuget-explorer.language')) {
      const config = vscode.workspace.getConfiguration('nuget-explorer');
      const language = config.get<string>('language', 'en');
      nugetProvider.notifyLanguageChanged(language);
    }
  });
  context.subscriptions.push(configChangeDisposable);

  // Commande pour ouvrir le panel NuGet
  const openPanelCommand = vscode.commands.registerCommand('nuget-explorer.openPanel', async () => {
    await vscode.commands.executeCommand('nuget-explorer.webview.focus');
  });
  context.subscriptions.push(openPanelCommand);

  // Commande de rafraîchissement
  const refreshCommand = vscode.commands.registerCommand('nuget-explorer.refresh', () => {
    vscode.window.showInformationMessage('Actualisation des packages NuGet...');
  });
  context.subscriptions.push(refreshCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {
  // Dispose the shared output channel
  VscLogger.disposeOutputChannel();
}
