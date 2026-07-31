import { spawn } from "child_process";
import { singleton } from "tsyringe";
import { InjectionToken } from "@/Shared";

export interface ProcessResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

export interface IProcessRunner {
  run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult>;
}

export const PROCESS_RUNNER = new InjectionToken<IProcessRunner>("IProcessRunner");

/**
 * Exécution réelle de processus enfants (I/O pur, non testé unitairement).
 * La sortie stdout+stderr est capturée intégralement.
 */
@singleton()
export class ChildProcessRunner implements IProcessRunner {
  public run(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<ProcessResult> {
    return new Promise((resolve) => {
      let output = "";
      let timedOut = false;
      const child = spawn(command, args, { cwd, shell: false });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ exitCode: null, output, timedOut: false }); // commande introuvable
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code, output, timedOut });
      });
    });
  }
}
