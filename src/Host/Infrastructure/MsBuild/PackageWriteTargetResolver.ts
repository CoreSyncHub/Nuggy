import * as path from "path";
import { singleton } from "tsyringe";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { PackageReferenceParser } from "@Infrastructure/Packages/PackageReferenceParser";
import { PackagesConfigParser } from "@Infrastructure/Packages/PackagesConfigParser";
import { CpmDiagnosticService } from "@Infrastructure/Packages/CpmDiagnosticService";
import { BuildConfigFileType } from "@Domain/Build/Enums/BuildConfigFileType";

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
    private readonly slnParser: SlnParser,
    private readonly slnxParser: SlnxParser,
    private readonly buildConfigDetector: BuildConfigDetector,
    private readonly buildConfigParser: BuildConfigParser,
    private readonly packageReferenceParser: PackageReferenceParser,
    private readonly packagesConfigParser: PackagesConfigParser,
    private readonly cpmDiagnosticService: CpmDiagnosticService,
  ) {}

  public async resolveTargets(
    solutionPath: string,
    packageId: string,
  ): Promise<{ targets: WriteTarget[]; cpmFilePath?: string }> {
    const ext = path.extname(solutionPath).toLowerCase();
    const projectPaths =
      ext === ".slnx"
        ? this.slnxParser.parse(solutionPath).projects.map((p) => p.path)
        : this.slnParser.parse(solutionPath).projects.map((p) => p.path);

    const buildConfigFiles = await this.buildConfigDetector.findAllConfigFiles();
    this.buildConfigDetector.buildHierarchy(buildConfigFiles);
    for (const file of buildConfigFiles) {
      this.buildConfigParser.parse(file.path, file);
    }
    const cpmFiles = buildConfigFiles.filter(
      (f) => f.type === BuildConfigFileType.DirectoryPackagesProps,
    );
    const solutionCpmFile = cpmFiles.length > 0 ? cpmFiles[0].path : undefined;

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
      const isCpm = solutionCpmFile !== undefined && (!ref || !ref.hasLocalVersion);
      if (isCpm) {
        return {
          projectPath,
          style: "CpmManaged",
          installedVersion: ref ? (ref.version ?? cpmVersion) : undefined,
          cpmFilePath: solutionCpmFile,
        };
      }
      return {
        projectPath,
        style: "PackageReference",
        installedVersion: ref?.version,
      };
    });

    return { targets, cpmFilePath: solutionCpmFile };
  }
}
