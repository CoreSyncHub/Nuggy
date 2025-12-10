import 'reflect-metadata';
import {
  provideFluentDesignSystem,
  fluentButton,
  fluentTextField,
  fluentSelect,
  fluentOption,
  fluentProgressRing,
  fluentBadge,
  fluentTabs,
  fluentTab,
  fluentTabPanel,
} from '@fluentui/web-components';

import { WebDependencyInjection } from './Core/DI/WebDependencyInjection';
import './App';
import { container } from 'tsyringe';
import { ILogger, LOGGER } from '@/Host/Application/Abstractions/Log/ILogger';
import { TranslationService } from './Core/Services/TranslationService';
import { RemoteBus } from './Core/Infrastructure/Messaging/RemoteBus';
import { IDispatcher, DISPATCHER } from '@Shared/Abstractions/Messaging/IDispatcher';
import { GetLanguageQuery } from '@Queries/GetLanguageQuery';

// Hot reload for VS Code extensions is not supported
// You must manually reload the extension window (Ctrl+R or F5) after changes

// Initialize Dependency Injection
const webDi = new WebDependencyInjection();
webDi.Provide();

// Register Fluent UI Web Components
const fluentDesignSystem = provideFluentDesignSystem();
fluentDesignSystem.register(
  fluentButton(),
  fluentTextField(),
  fluentSelect(),
  fluentOption(),
  fluentProgressRing(),
  fluentBadge(),
  fluentTabs(),
  fluentTab(),
  fluentTabPanel()
);

// Debug: Verify components are registered
console.log('[DEBUG] Fluent UI registered. Checking components...');
console.log('[DEBUG] fluent-button:', customElements.get('fluent-button'));
console.log('[DEBUG] fluent-progress-ring:', customElements.get('fluent-progress-ring'));

// Initialize TranslationService
async function initializeTranslations() {
  const logger = container.resolve<ILogger>(LOGGER.token);
  const translationService = container.resolve(TranslationService);
  const dispatcher = container.resolve<IDispatcher>(DISPATCHER.token);
  const remoteBus = container.resolve(RemoteBus);

  try {
    // Query the current language from VSCode settings
    logger.Info('Querying current language setting...');
    const language = (await dispatcher.Send(new GetLanguageQuery())) as string;
    logger.Info(`Current language: ${language}`);

    // Load the translation file
    await translationService.loadLanguage(language);
    logger.Info(`Translations loaded for language: ${language}`);

    // Listen for language change events from the Host
    remoteBus.onEvent('LanguageChangedEvent', async (payload: { language: string }) => {
      logger.Info(`Language changed to: ${payload.language}`);
      await translationService.changeLanguage(payload.language);
    });
  } catch (error) {
    logger.Error('Failed to initialize translations', error as Error);
    // Fallback to English
    await translationService.loadLanguage('en');
  }
}

// Mount the App component
const logger = container.resolve<ILogger>(LOGGER.token);
logger.Info('Mounting App component...');

// Initialize translations before mounting
initializeTranslations()
  .then(() => {
    logger.Info('Translations initialized, mounting app...');
    const app = document.createElement('nuget-app');
    const root = document.getElementById('app');
    if (root) {
      // Remove the initial loading placeholder and mount the app
      root.innerHTML = '';
      root.appendChild(app);
    } else {
      document.body.appendChild(app);
    }
  })
  .catch((error) => {
    logger.Error('Failed to initialize app', error as Error);
    // Mount app anyway with default English
    const app = document.createElement('nuget-app');
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML = '';
      root.appendChild(app);
    } else {
      document.body.appendChild(app);
    }
  });
