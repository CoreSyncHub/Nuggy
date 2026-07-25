import { singleton } from "tsyringe";
import { NuGetFramework } from "@Domain/Projects/NuGetFramework";

export interface CompatibilityResult {
  verdict: "Compatible" | "Incompatible" | "Unknown";
  reason?: string;
}

/**
 * Table de compatibilité pragmatique entre TFM (sous-ensemble des règles NuGet.Client).
 * Tout TFM non couvert produit un verdict Unknown, jamais un verdict inventé.
 */
@singleton()
export class TfmCompatibilityService {
  public isCompatible(projectTfm: string, packageFrameworks: string[]): CompatibilityResult {
    if (packageFrameworks.length === 0) {
      return { verdict: "Compatible" };
    }

    const project = NuGetFramework.parse(projectTfm);
    if (project.family === "unknown") {
      return { verdict: "Unknown", reason: `TFM projet non reconnu : ${projectTfm}` };
    }

    let sawUnknown = false;
    for (const packageTfm of packageFrameworks) {
      const pkg = NuGetFramework.parse(packageTfm);
      if (pkg.family === "unknown") {
        sawUnknown = true;
        continue;
      }
      if (this.accepts(project, pkg)) {
        return { verdict: "Compatible" };
      }
    }

    if (sawUnknown) {
      return { verdict: "Unknown", reason: "framework(s) du package non reconnus" };
    }
    // Le TFM du projet n'est pas répété : l'UI l'affiche déjà à côté du verdict.
    return {
      verdict: "Incompatible",
      reason: `requiert ${packageFrameworks.join(" ou ")}`,
    };
  }

  private accepts(project: NuGetFramework, pkg: NuGetFramework): boolean {
    // Même famille : version du package ≤ version du projet, plateforme cohérente
    if (project.family === pkg.family) {
      if (!project.versionAtLeast(pkg)) {
        return false;
      }
      if (pkg.platform === undefined) {
        return true;
      }
      return project.platform === pkg.platform;
    }

    // Le package cible une plateforme spécifique d'une autre famille → jamais compatible
    if (pkg.platform !== undefined) {
      return false;
    }

    switch (project.family) {
      case "net5plus":
        if (pkg.family === "netcoreapp") {
          return true;
        } // netcoreapp3.1- consommable par net5+
        if (pkg.family === "netstandard") {
          return pkg.major < 2 || (pkg.major === 2 && pkg.minor <= 1);
        }
        return false;
      case "netcoreapp":
        if (pkg.family !== "netstandard") {
          return false;
        }
        // netcoreapp3.x ⊇ netstandard2.1- ; 2.x ⊇ 2.0- ; 1.x ⊇ 1.6-
        if (project.major >= 3) {
          return pkg.major < 2 || (pkg.major === 2 && pkg.minor <= 1);
        }
        if (project.major === 2) {
          return pkg.major < 2 || (pkg.major === 2 && pkg.minor === 0);
        }
        return pkg.major === 1 && pkg.minor <= 6;
      case "netframework": {
        if (pkg.family !== "netstandard") {
          return false;
        }
        const maxNetstandard = this.maxNetstandardForNetFramework(project);
        if (maxNetstandard === null) {
          return false;
        }
        const [maxMajor, maxMinor] = maxNetstandard;
        return pkg.major < maxMajor || (pkg.major === maxMajor && pkg.minor <= maxMinor);
      }
      default:
        return false;
    }
  }

  /** Table officielle Microsoft netframework → netstandard maximal supporté. */
  private maxNetstandardForNetFramework(fw: NuGetFramework): [number, number] | null {
    const v = fw.major * 100 + fw.minor * 10 + fw.patch;
    if (v >= 461) {
      return [2, 0];
    } // net461+ → netstandard2.0
    if (v >= 460) {
      return [1, 3];
    }
    if (v >= 451) {
      return [1, 2];
    } // net451/net452
    if (v >= 450) {
      return [1, 1];
    } // net45
    return null; // < net45 : aucun netstandard
  }
}
