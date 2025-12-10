import { IQuery } from '../../Abstractions/Messaging/IQuery';

/**
 * Query to get the current language setting from VSCode configuration.
 * Returns a language code (e.g., 'en', 'fr', 'es', 'de').
 */
export class GetLanguageQuery implements IQuery<string> {
  constructor() {}
}
