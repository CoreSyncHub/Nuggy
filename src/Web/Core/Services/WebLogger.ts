import { singleton } from 'tsyringe';
import { ILogger } from '@/Host/Application/Abstractions/Log/ILogger';

/**
 * Logger implementation for WebView.
 * Logs to browser console only.
 */
@singleton()
export class WebLogger implements ILogger {
  private readonly isDevelopment: boolean;
  private readonly prefix: string = '[NuGet Explorer]';

  constructor() {
    this.isDevelopment = true;
  }

  Info(message: string, context?: Record<string, unknown>): void {
    const formatted = this.formatMessage('INFO', message);
    if (context) {
      console.log(formatted, context);
    } else {
      console.log(formatted);
    }
  }

  Warning(message: string, context?: Record<string, unknown>): void {
    const formatted = this.formatMessage('WARN', message);
    if (context) {
      console.warn(formatted, context);
    } else {
      console.warn(formatted);
    }
  }

  Error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const formatted = this.formatMessage('ERROR', message);
    if (error && context) {
      console.error(formatted, error, context);
    } else if (error) {
      console.error(formatted, error);
    } else if (context) {
      console.error(formatted, context);
    } else {
      console.error(formatted);
    }
  }

  Debug(message: string, context?: Record<string, unknown>): void {
    if (!this.isDevelopment) {
      return; // Skip debug logs in production
    }

    const formatted = this.formatMessage('DEBUG', message);
    if (context) {
      console.debug(formatted, context);
    } else {
      console.debug(formatted);
    }
  }

  /**
   * Format a log message with prefix and level
   */
  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toLocaleTimeString();
    return `${this.prefix} [${timestamp}] [${level}] ${message}`;
  }
}
