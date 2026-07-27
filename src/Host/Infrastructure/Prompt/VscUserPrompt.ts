import * as vscode from "vscode";
import { singleton } from "tsyringe";
import { type IUserPrompt } from "@Application/Abstractions/Prompt/IUserPrompt";

@singleton()
export class VscUserPrompt implements IUserPrompt {
  public async confirm(message: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Continue");
    return choice === "Continue";
  }
}
