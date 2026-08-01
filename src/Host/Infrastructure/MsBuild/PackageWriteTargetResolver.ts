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
 * Resolves, for a given package, the write state of every project in the
 * solution: reference style, installed version, applicable CPM file.
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
      // The applicable CPM file is the one MSBuild would keep while walking up from
      // this project — not the first one in the solution. A project outside any CPM
      // scope is not centrally managed, even if the solution holds such a file.
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

    // Solution-wide fallback: the CPM file of a target that is actually centrally
    // managed. Callers use it when a target carries none.
    const cpmFilePath = targets.find((t) => t.cpmFilePath !== undefined)?.cpmFilePath;
    return { targets, cpmFilePath };
  }
}
