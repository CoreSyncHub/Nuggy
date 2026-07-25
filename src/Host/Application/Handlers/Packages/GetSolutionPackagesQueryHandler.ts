import { injectable } from "tsyringe";
import * as path from "path";
import { type IQueryHandler } from "@Shared/Abstractions/Messaging/IQueryHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { GetSolutionPackagesQuery } from "@Shared/Features/Queries/GetSolutionPackagesQuery";
import {
  type PackageInstallationDto,
  type SolutionPackageDto,
  type SolutionPackagesDto,
} from "@Shared/Features/Dtos/SolutionPackagesDto";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { PackageReferenceParser } from "@Infrastructure/Packages/PackageReferenceParser";
import { PackagesConfigParser } from "@Infrastructure/Packages/PackagesConfigParser";
import { CpmDiagnosticService } from "@Infrastructure/Packages/CpmDiagnosticService";
import { NuGetConfigResolver } from "@Infrastructure/Packages/NuGetConfigResolver";
import { TfmResolver } from "@Infrastructure/Projects/TfmResolver";

@injectable()
@HandlerFor(GetSolutionPackagesQuery)
export class GetSolutionPackagesQueryHandler implements IQueryHandler<
  GetSolutionPackagesQuery,
  SolutionPackagesDto
> {
  constructor(
    private readonly slnParser: SlnParser,
    private readonly slnxParser: SlnxParser,
    private readonly buildConfigDetector: BuildConfigDetector,
    private readonly buildConfigParser: BuildConfigParser,
    private readonly packageReferenceParser: PackageReferenceParser,
    private readonly packagesConfigParser: PackagesConfigParser,
    private readonly cpmDiagnosticService: CpmDiagnosticService,
    private readonly nuGetConfigResolver: NuGetConfigResolver,
    private readonly tfmResolver: TfmResolver,
  ) {}

  async Handle(query: GetSolutionPackagesQuery): Promise<SolutionPackagesDto> {
    const projectPaths = this.parseProjects(query.solutionPath);

    const buildConfigFiles = await this.buildConfigDetector.findAllConfigFiles();
    this.buildConfigDetector.buildHierarchy(buildConfigFiles);
    for (const file of buildConfigFiles) {
      this.buildConfigParser.parse(file.path, file);
    }
    const resolvedTfms = this.tfmResolver.resolveMultiple(projectPaths, buildConfigFiles);

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

    const resolution = this.nuGetConfigResolver.resolve(query.solutionPath);
    const uninterrogatedFeeds = this.nuGetConfigResolver
      .getPrivateFeeds(resolution)
      .map((source) => source.name);

    return { packages, uninterrogatedFeeds };
  }

  private parseProjects(solutionPath: string): string[] {
    const ext = path.extname(solutionPath).toLowerCase();
    if (ext === ".slnx") {
      return this.slnxParser.parse(solutionPath).projects.map((p) => p.path);
    }
    if (ext === ".sln") {
      return this.slnParser.parse(solutionPath).projects.map((p) => p.path);
    }
    throw new Error(`Unsupported solution format: ${ext}`);
  }
}
