import { IQueryHandler } from '@Shared/Abstractions/Messaging/IQueryHandler';
import { HandlerFor } from '@Shared/Infrastructure/Messaging/HandlerFor';
import { GetLanguageQuery } from '@Queries/GetLanguageQuery';
import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import { ILogger, LOGGER } from '../../Abstractions/Log/ILogger';
import { injectToken } from '@Shared/DependencyInjection/inject';

/**
 * Handler for GetLanguageQuery.
 * Reads the language setting from VSCode configuration and returns the language code.
 */
@injectable()
@HandlerFor(GetLanguageQuery)
export class GetLanguageQueryHandler implements IQueryHandler<GetLanguageQuery, string> {
  constructor(@injectToken(LOGGER) private readonly _logger: ILogger) {}

  async Handle(_: GetLanguageQuery): Promise<string> {
    try {
      const config = vscode.workspace.getConfiguration('nuget-explorer');
      const language = config.get<string>('language', 'en');

      this._logger.Info(`GetLanguageQueryHandler: Retrieved language setting: ${language}`);

      // Validate language code
      const validLanguages = ['en', 'fr', 'es', 'de'];
      if (!validLanguages.includes(language)) {
        this._logger.Warning(`Invalid language code: ${language}, defaulting to 'en'`);
        return 'en';
      }

      return language;
    } catch (error) {
      this._logger.Error(`Error retrieving language setting: ${error}`);
      return 'en'; // Default fallback
    }
  }
}
