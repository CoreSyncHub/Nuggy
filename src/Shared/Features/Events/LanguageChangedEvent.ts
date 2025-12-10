/**
 * Event that is sent from Host to WebView when the language configuration changes.
 * The WebView should update its TranslationService when receiving this event.
 */
export class LanguageChangedEvent {
  constructor(public readonly language: string) {}
}
