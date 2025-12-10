import * as vscode from 'vscode';
import { ILogger, LOGGER } from '@Application/Abstractions/Log/ILogger';
import { getHtmlForWebview } from './webviewHtml';
import { WebMediator } from './WebMediator';
import { IDispatcher, DISPATCHER } from '../../Shared/Abstractions/Messaging/IDispatcher';
import { container } from 'tsyringe';
import { GetLanguageQuery } from '@/Shared/Features/Queries/GetLanguageQuery';
import { GetWorkspaceSolutionsQuery } from '@/Shared/Features/Queries/GetWorkspaceSolutionsQuery';
import { GetSolutionStructureQuery } from '@/Shared/Features/Queries/GetSolutionStructureQuery';
import { SelectSolutionCommand } from '@/Shared/Features/Commands/SelectSolutionCommand';

/**
 * Provider for the NuGet Explorer webview displayed in the bottom panel.
 * All business logic is now handled through WebMediator/Dispatcher pattern.
 */
export class NuGetWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'nuget-explorer.webview';

  private webviewView?: vscode.WebviewView;
  private webMediator?: WebMediator;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Called by VS Code to resolve the WebviewView for the contributed view.
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'node_modules'),
      ],
    };

    webviewView.webview.html = getHtmlForWebview(this.extensionUri, webviewView.webview);

    // Create a WebMediator that will route REQUEST/RESPONSE messages through the host Dispatcher.
    // The WebMediator listens directly to webview messages; the provider no longer needs
    // to forward UI messages to host-side ViewModels — presentation is managed in the WebView.
    const dispatcher = container.resolve<IDispatcher>(DISPATCHER.token);
    const logger = container.resolve<ILogger>(LOGGER.token);
    this.webMediator = new WebMediator(webviewView.webview, dispatcher, logger);

    // Register known request/command DTOs so WebMediator can rehydrate instances from JSON.
    this.webMediator.registerRequestType('GetLanguageQuery', GetLanguageQuery);
    this.webMediator.registerRequestType(
      'GetWorkspaceSolutionsQuery',
      GetWorkspaceSolutionsQuery
    );
    this.webMediator.registerRequestType(
      'GetSolutionStructureQuery',
      GetSolutionStructureQuery
    );
    this.webMediator.registerRequestType('SelectSolutionCommand', SelectSolutionCommand);
  }

  /**
   * Notify the webview that the language configuration has changed
   * @param language The new language code
   */
  public notifyLanguageChanged(language: string): void {
    if (this.webMediator) {
      this.webMediator.sendEvent('LanguageChangedEvent', { language });
    }
  }
}
