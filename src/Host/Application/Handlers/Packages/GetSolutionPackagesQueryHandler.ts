import { injectable } from "tsyringe";
import { ProjectTfmResolutionService } from "@Infrastructure/Projects/ProjectTfmResolutionService";

import * as path from "path";
import { type IQueryHandler } from "@Shared/Abstractions/Messaging/IQueryHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { GetSolutionPackagesQuery } from "@Shared/Features/Queries/GetSolutionPackagesQuery";
import {
  type PackageInstallationDto,
  type PackageReferenceStyle,
  type SolutionPackageDto,
  type SolutionPackagesDto,
  type SolutionProjectDto,
} from "@Shared/Features/Dtos/SolutionPackagesDto";
import { BuildConfigFileType } from "@Domain/Build/Enums/BuildConfigFileType";
import { PackageReferenceParser } from "@Infrastructure/Packages/PackageReferenceParser";
import { PackagesConfigParser } from "@Infrastructure/Packages/PackagesConfigParser";
import { CpmDiagnosticService } from "@Infrastructure/Packages/CpmDiagnosticService";
import { NuGetConfigResolver } from "@Infrastructure/Packages/NuGetConfigResolver";

@injectable()
@HandlerFor(GetSolutionPackagesQuery)
export class GetSolutionPackagesQueryHandler implements IQueryHandler<
  GetSolutionPackagesQuery,
  SolutionPackagesDto
> {
  constructor(
    private readonly tfmResolution: ProjectTfmResolutionService,
    private readonly packageReferenceParser: PackageReferenceParser,
    private readonly packagesConfigParser: PackagesConfigParser,
    private readonly cpmDiagnosticService: CpmDiagnosticService,
    private readonly nuGetConfigResolver: NuGetConfigResolver,
  ) {}

  async Handle(query: GetSolutionPackagesQuery): Promise<SolutionPackagesDto> {
    const { projectPaths, buildConfigFiles, resolvedTfms } =
      await this.tfmResolution.resolveSolution(query.solutionPath);

    const sdkProjects = projectPaths.filter((p) => !this.packagesConfigParser.isLegacyProject(p));
    const legacyProjects = projectPaths.filter((p) => this.packagesConfigParser.isLegacyProject(p));

    const packageReferences = this.packageReferenceParser.parseMultiple(sdkProjects);
    const cpmResult = this.cpmDiagnosticService.analyze(buildConfigFiles, packageReferences);
    const cpmVersionByPackage = new Map(
      cpmResult.packageVersions.map((pv) => [pv.name.toLowerCase(), pv.version]),
    );

    // NuGet package ids are case-insensitive: consolidate on the lowercased
    // id while keeping the first-seen casing as the display id.
    const byId = new Map<string, PackageInstallationDto[]>();
    const displayNames = new Map<string, string>();
    const add = (id: string, installation: PackageInstallationDto) => {
      const key = id.toLowerCase();
      if (!byId.has(key)) {
        byId.set(key, []);
        displayNames.set(key, id);
      }
      byId.get(key)!.push(installation);
    };
    const tfmsOf = (projectPath: string): string[] =>
      resolvedTfms.get(projectPath)?.targetFrameworks ?? [];

    for (const [projectPath, references] of packageReferences) {
      for (const ref of references) {
        const cpmVersion = cpmVersionByPackage.get(ref.name.toLowerCase());
        const isCpmManaged = !ref.hasLocalVersion && cpmVersion !== undefined;
        add(ref.name, {
          projectPath,
          projectName: path.basename(projectPath, ".csproj"),
          effectiveTfms: tfmsOf(projectPath),
          installedVersion: ref.version ?? cpmVersion ?? "unknown",
          referenceStyle: isCpmManaged ? "CpmManaged" : "PackageReference",
        });
      }
    }

    const legacyPackages = this.packagesConfigParser.parseMultiple(legacyProjects);
    for (const [projectPath, packages] of legacyPackages) {
      for (const legacy of packages) {
        add(legacy.name, {
          projectPath,
          projectName: path.basename(projectPath, ".csproj"),
          effectiveTfms: tfmsOf(projectPath),
          installedVersion: legacy.version ?? "unknown",
          referenceStyle: "PackagesConfig",
        });
      }
    }

    const packages: SolutionPackageDto[] = [...byId.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, installations]) => {
        const id = displayNames.get(key)!;
        const sorted = [...installations].sort((a, b) =>
          a.projectName.localeCompare(b.projectName),
        );
        return {
          id,
          iconUrl: `https://api.nuget.org/v3-flatcontainer/${key}/${sorted[0].installedVersion}/icon`,
          installations: sorted,
        };
      });

    // Style qu'aurait une installation dans un projet qui n'a pas encore le package.
    // Même sémantique que PackageWriteTargetResolver (la présence d'un
    // Directory.Packages.props suffit : l'install créera une référence sans Version
    // plus le PackageVersion manquant), sinon l'UI promettrait un bouton que
    // l'écriture Host refuserait.
    const solutionHasCpmFile = buildConfigFiles.some(
      (f) => f.type === BuildConfigFileType.DirectoryPackagesProps,
    );
    const styleOf = (projectPath: string): PackageReferenceStyle => {
      if (this.packagesConfigParser.isLegacyProject(projectPath)) {
        return "PackagesConfig";
      }
      return solutionHasCpmFile ? "CpmManaged" : "PackageReference";
    };
    const projects: SolutionProjectDto[] = projectPaths
      .map((projectPath) => ({
        projectPath,
        projectName: path.basename(projectPath, ".csproj"),
        effectiveTfms: tfmsOf(projectPath),
        referenceStyle: styleOf(projectPath),
      }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName));

    const resolution = this.nuGetConfigResolver.resolve(query.solutionPath);
    const uninterrogatedFeeds = this.nuGetConfigResolver
      .getPrivateFeeds(resolution)
      .map((source) => source.name);

    return { packages, projects, uninterrogatedFeeds };
  }
}
