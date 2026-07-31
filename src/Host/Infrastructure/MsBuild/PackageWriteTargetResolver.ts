import * as path from "path";
import { singleton } from "tsyringe";
import { ProjectTfmResolutionService } from "../Projects/ProjectTfmResolutionService";
import { PackageReferenceParser } from "@Infrastructure/Packages/PackageReferenceParser";
import { PackagesConfigParser } from "@Infrastructure/Packages/PackagesConfigParser";
import { CpmDiagnosticService } from "@Infrastructure/Packages/CpmDiagnosticService";
import { findGoverningCpmFile } from "@Infrastructure/Packages/CpmFileLocator";

export interface WriteTarget {
  projectPath: string;
  style: "PackageReference" | "CpmManaged" | "PackagesConfig";
  installedVersion?: string;
  cpmFilePath?: string;
}

/**
 * Résout, pour un package donné, l'état d'écriture de chaque projet de la
 * solution : style de référence, version installée, fichier CPM applicable.
 */
@singleton()
export class PackageWriteTargetResolver {
  constructor(
    private readonly tfmResolution: ProjectTfmResolutionService,
    private readonly packageReferenceParser: PackageReferenceParser,
    private readonly packagesConfigParser: PackagesConfigParser,
    private readonly cpmDiagnosticService: CpmDiagnosticService,
  ) {}

  public async resolveTargets(
    solutionPath: string,
    packageId: string,
  ): Promise<{ targets: WriteTarget[]; cpmFilePath?: string }> {
    const projectPaths = this.tfmResolution.parseProjectPaths(solutionPath);
    const buildConfigFiles = await this.tfmResolution.loadBuildConfigFiles();

    const sdkProjects = projectPaths.filter((p) => !this.packagesConfigParser.isLegacyProject(p));
    const references = this.packageReferenceParser.parseMultiple(sdkProjects);
    const cpmResult = this.cpmDiagnosticService.analyze(buildConfigFiles, references);
    const cpmVersion = cpmResult.packageVersions.find(
      (pv) => pv.name.toLowerCase() === packageId.toLowerCase(),
    )?.version;

    const targets: WriteTarget[] = projectPaths.map((projectPath) => {
      if (this.packagesConfigParser.isLegacyProject(projectPath)) {
        return { projectPath, style: "PackagesConfig" };
      }
      const ref = (references.get(projectPath) ?? []).find(
        (r) => r.name.toLowerCase() === packageId.toLowerCase(),
      );
      // Le fichier CPM applicable est celui que MSBuild retiendrait en remontant
      // depuis ce projet — pas le premier de la solution. Un projet hors de toute
      // portée CPM n'est pas géré centralement, même si la solution en contient.
      const projectCpmFile = findGoverningCpmFile(projectPath, buildConfigFiles);
      const isCpm = projectCpmFile !== undefined && (!ref || !ref.hasLocalVersion);
      if (isCpm) {
        return {
          projectPath,
          style: "CpmManaged",
          installedVersion: ref ? (ref.version ?? cpmVersion) : undefined,
          cpmFilePath: projectCpmFile,
        };
      }
      return {
        projectPath,
        style: "PackageReference",
        installedVersion: ref?.version,
      };
    });

    // Repli solution-wide : le fichier CPM d'une cible effectivement gérée
    // centralement. Les appelants s'en servent quand une cible n'en porte pas.
    const cpmFilePath = targets.find((t) => t.cpmFilePath !== undefined)?.cpmFilePath;
    return { targets, cpmFilePath };
  }
}
