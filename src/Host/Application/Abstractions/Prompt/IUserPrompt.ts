import { InjectionToken } from "@/Shared";

/**
 * UserPrompt abstraction for user interaction.
 * Provides methods to prompt the user for confirmation.
 */
export interface IUserPrompt {
  /**
   * Confirm a message to the user and return a promise that resolves to true if the user accepts, or false otherwise.
   * @param message - The message to display in the confirmation prompt
   */
  confirm(message: string): Promise<boolean>;
}

export const USER_PROMPT = new InjectionToken<IUserPrompt>("IUserPrompt");
