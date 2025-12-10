import * as vscode from 'vscode';
import { injectable } from 'tsyringe';
import { ILogger } from '@Application/Abstractions/Log/ILogger';

/**
 * Logger implementation for VSCode Host.
 * Logs to both console and VSCode Output Channel.
 *
 * Note: The Output Channel is shared across all instances to avoid
 * creating duplicate channels in the VSCode UI.
 */
@injectable()
export class VscLogger implements ILogger {
  private static outputChannel: vscode.OutputChannel | null = null;
  private readonly isDevelopment: boolean;

  constructor() {
    // Create the output channel only once (shared across all logger instances)
    if (!VscLogger.outputChannel) {
      VscLogger.outputChannel = vscode.window.createOutputChannel('NuGet Explorer');
    }
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  /**
   * Get the shared output channel instance
   */
  private get outputChannel(): vscode.OutputChannel {
    if (!VscLogger.outputChannel) {
      throw new Error('Output channel not initialized');
    }
    return VscLogger.outputChannel;
  }

  Info(message: string, context?: Record<string, unknown>): void {
    const formatted = this.formatMessage('INFO', message, context);
    this.outputChannel.appendLine(formatted);
  }

  Warning(message: string, context?: Record<string, unknown>): void {
    const formatted = this.formatMessage('WARN', message, context);
    console.warn(formatted);
    this.outputChannel.appendLine(formatted);
  }

  Error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const formatted = this.formatMessage('ERROR', message, context);
    console.error(formatted, error);
    this.outputChannel.appendLine(formatted);
    if (error) {
      this.outputChannel.appendLine(`  Stack: ${error.stack}`);
    }
  }

  Debug(message: string, context?: Record<string, unknown>): void {
    if (!this.isDevelopment) {
      return; // Skip debug logs in production
    }

    const formatted = this.formatMessage('DEBUG', message, context);
    console.debug(formatted);
    this.outputChannel.appendLine(formatted);
  }

  /**
   * Format a log message with timestamp, level, and optional context
   */
  private formatMessage(level: string, message: string, context?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${level}] ${message}${contextStr}`;
  }

  /**
   * Show the output channel (useful for debugging)
   */
  show(): void {
    this.outputChannel.show();
  }

  /**
   * Dispose the shared output channel.
   * Should be called when the extension is deactivated.
   */
  static disposeOutputChannel(): void {
    if (VscLogger.outputChannel) {
      VscLogger.outputChannel.dispose();
      VscLogger.outputChannel = null;
    }
  }
}
