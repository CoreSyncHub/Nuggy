import { singleton } from "tsyringe";
import { translate, type TranslationDictionary, type TranslationParams } from "./TranslationLookup";

/**
 * Type for translation keys using dot notation
 */
type TranslationKey = string;

/**
 * Type for language change callback
 */
type LanguageChangeCallback = (language: string) => void;

/**
 * TranslationService - Singleton service for managing translations in the WebView.
 * Supports loading translations, interpolation, and dynamic language switching.
 */
@singleton()
export class TranslationService {
  private currentLanguage: string = "en";
  private translations: TranslationDictionary = {};
  /** English dictionary, loaded once: a per-key safety net for incomplete languages,
   *  which otherwise displayed the raw key path in the interface. */
  private fallbackTranslations: TranslationDictionary = {};
  private listeners: Set<LanguageChangeCallback> = new Set();

  /**
   * Load translations for a specific language
   * @param lang Language code (e.g., 'en', 'fr', 'es', 'de')
   */
  async loadLanguage(lang: string): Promise<void> {
    try {
      // Import translations JSON file dynamically
      const i18nBaseUri = window.__I18N_URI__;
      const url = `${i18nBaseUri}/${lang}.json`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Failed to load language file: ${lang}.json`);
        // Fallback to English if the language file can't be loaded
        if (lang !== "en") {
          await this.loadLanguage("en");
        }
        return;
      }

      this.translations = await response.json();
      this.currentLanguage = lang;
      await this.ensureFallbackLoaded();

      // Notify all listeners about the language change
      this.notifyListeners();
    } catch (error) {
      console.error(`Error loading language ${lang}:`, error);
      // Fallback to English on error
      if (lang !== "en") {
        await this.loadLanguage("en");
      }
    }
  }

  /**
   * Get translation for a key with optional parameter interpolation
   * @param key Translation key in dot notation (e.g., 'packages.install')
   * @param params Optional parameters for interpolation
   * @returns Translated string
   */
  t(key: TranslationKey, params?: TranslationParams): string {
    const value = translate(this.translations, this.fallbackTranslations, key, params);
    if (value === key) {
      console.warn(`Translation key not found: ${key}`);
    }
    return value;
  }

  /**
   * Loads English as the fallback dictionary. In English, both point at the same
   * object: no extra request. A loading failure leaves the fallback empty — `t()`
   * then returns the key, as it did before this fix.
   */
  private async ensureFallbackLoaded(): Promise<void> {
    if (this.currentLanguage === "en") {
      this.fallbackTranslations = this.translations;
      return;
    }
    if (Object.keys(this.fallbackTranslations).length > 0) {
      return;
    }
    try {
      const response = await fetch(`${window.__I18N_URI__}/en.json`);
      if (response.ok) {
        this.fallbackTranslations = await response.json();
      }
    } catch (error) {
      console.error("Error loading fallback language en:", error);
    }
  }

  /**
   * Get the current language code
   * @returns Current language code
   */
  getCurrentLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * Subscribe to language changes
   * @param callback Function to call when language changes
   * @returns Unsubscribe function
   */
  subscribe(callback: LanguageChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners about language change
   */
  private notifyListeners(): void {
    this.listeners.forEach((callback) => {
      try {
        callback(this.currentLanguage);
      } catch (error) {
        console.error("Error in language change listener:", error);
      }
    });
  }

  /**
   * Change the current language
   * @param lang Language code
   */
  async changeLanguage(lang: string): Promise<void> {
    if (lang !== this.currentLanguage) {
      await this.loadLanguage(lang);
    }
  }
}
