import { InjectionToken } from "@/Shared";

export interface IUserPrompt {
  /** Confirmation modale ; résout true si l'utilisateur accepte. */
  confirm(message: string): Promise<boolean>;
}

export const USER_PROMPT = new InjectionToken<IUserPrompt>("IUserPrompt");
