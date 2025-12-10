import { InjectionToken } from '@/Shared';

/**
 * Logger abstraction for structured logging.
 * Provides methods for different log levels.
 */
export interface ILogger {
  /**
   * Log an informational message
   * @param message - The message to log
   * @param context - Optional context object for structured logging
   */
  Info(message: string, context?: Record<string, unknown>): void;

  /**
   * Log a warning message
   * @param message - The message to log
   * @param context - Optional context object for structured logging
   */
  Warning(message: string, context?: Record<string, unknown>): void;

  /**
   * Log an error message
   * @param message - The message to log
   * @param error - Optional Error object
   * @param context - Optional context object for structured logging
   */
  Error(message: string, error?: Error, context?: Record<string, unknown>): void;

  /**
   * Log a debug message (only in development)
   * @param message - The message to log
   * @param context - Optional context object for structured logging
   */
  Debug(message: string, context?: Record<string, unknown>): void;
}

export const LOGGER = new InjectionToken<ILogger>('ILogger');
