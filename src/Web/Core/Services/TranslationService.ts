import { singleton } from 'tsyringe';

/**
 * Type for translation keys using dot notation
 */
type TranslationKey = string;

/**
 * Type for translation parameters
 */
type TranslationParams = Record<string, string | number>;

/**
 * Type for translation dictionary
 */
type TranslationDictionary = Record<string, any>;

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
  private currentLanguage: string = 'en';
  private translations: TranslationDictionary = {};
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
        if (lang !== 'en') {
          await this.loadLanguage('en');
        }
        return;
      }

      this.translations = await response.json();
      this.currentLanguage = lang;

      // Notify all listeners about the language change
      this.notifyListeners();
    } catch (error) {
      console.error(`Error loading language ${lang}:`, error);
      // Fallback to English on error
      if (lang !== 'en') {
        await this.loadLanguage('en');
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
    // Navigate through the translation object using dot notation
    const keys = key.split('.');
    let value: any = this.translations;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        // Key not found, return the key itself as fallback
        console.warn(`Translation key not found: ${key}`);
        return key;
      }
    }

    // If the final value is not a string, return the key
    if (typeof value !== 'string') {
      console.warn(`Translation value is not a string for key: ${key}`);
      return key;
    }

    // Apply parameter interpolation if params are provided
    if (params) {
      return this.interpolate(value, params);
    }

    return value;
  }

  /**
   * Interpolate parameters in a translation string
   * Supports {{paramName}} syntax
   * @param text Translation string with placeholders
   * @param params Parameters to interpolate
   * @returns Interpolated string
   */
  private interpolate(text: string, params: TranslationParams): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (key in params) {
        return String(params[key]);
      }
      return match;
    });
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
        console.error('Error in language change listener:', error);
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
