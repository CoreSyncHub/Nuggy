import { injectable } from "tsyringe";
import { type IQueryHandler } from "@Shared/Abstractions/Messaging/IQueryHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { GetPackageUpdateInfoQuery } from "@Shared/Features/Queries/GetPackageUpdateInfoQuery";
import {
  type CompatibilityVerdict,
  type PackageUpdateInfoDto,
  type PackageVersionInfoDto,
  type ProjectVerdictDto,
} from "@Shared/Features/Dtos/PackageUpdateInfoDto";
import {
  NuGetApiError,
  NuGetV3ApiClient,
  type RegistrationLeaf,
} from "@Infrastructure/NuGet/NuGetV3ApiClient";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import { TfmCompatibilityService } from "@Infrastructure/Projects/TfmCompatibilityService";
import { ProjectTfmResolutionService } from "@Infrastructure/Projects/ProjectTfmResolutionService";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import { type ILogger, LOGGER } from "../../Abstractions/Log/ILogger";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { compareVersionsDesc } from "@Shared/Features/Versions/CompareVersions";

@injectable()
@HandlerFor(GetPackageUpdateInfoQuery)
export class GetPackageUpdateInfoQueryHandler implements IQueryHandler<
  GetPackageUpdateInfoQuery,
  PackageUpdateInfoDto
> {
  constructor(
    private readonly apiClient: NuGetV3ApiClient,
    private readonly cache: PackageMetadataCache,
    private readonly compatibility: TfmCompatibilityService,
    private readonly tfmResolution: ProjectTfmResolutionService,
    private readonly tfmCache: ProjectTfmCache,
    @injectToken(LOGGER) private readonly logger: ILogger,
  ) {}

  async Handle(query: GetPackageUpdateInfoQuery): Promise<PackageUpdateInfoDto> {
    // Two solutions with the same packageId but different project TFMs must not share a cache entry, as compatibility verdicts depend on the projects in the active solution.
    const cacheKey = `${query.solutionPath}::${query.packageId.toLowerCase()}`;
    return this.cache.getOrFetch(cacheKey, () => this.fetchAndAssemble(query));
  }

  private async fetchAndAssemble(query: GetPackageUpdateInfoQuery): Promise<PackageUpdateInfoDto> {
    let projectTfms = new Map<string, string[]>();
    try {
      projectTfms = await this.tfmCache.getOrResolve(query.solutionPath, () =>
        this.tfmResolution.resolveProjectTfms(query.solutionPath),
      );
    } catch (error) {
      // Failure to resolve project TFMs (missing/invalid solution) should never cause the handler to reject or be confused with a network 'Offline' status.
      this.logger.Error("Failed to resolve project TFMs from solution", error as Error);
    }

    try {
      const [leaves, search] = await Promise.all([
        this.apiClient.getRegistrationLeaves(query.packageId),
        this.apiClient.searchPackage(query.packageId),
      ]);

      const versions = leaves
        .filter((leaf) => leaf.listed)
        .sort((a, b) => compareVersionsDesc(a.version, b.version))
        .map((leaf) => this.toVersionInfo(leaf, projectTfms));

      const licenseUrl = search?.licenseUrl;
      const expressionMatch = licenseUrl?.match(/^https:\/\/licenses\.nuget\.org\/(.+)$/);

      const isMicrosoft = this.isMicrosoftPublisher(search?.owners, search?.authors);

      return {
        id: query.packageId,
        verified: search?.verified ?? false,
        isMicrosoft,
        authors: search?.authors ?? "",
        publishedUtc: versions.find((v) => !v.isPrerelease)?.publishedUtc,
        totalDownloads: search?.totalDownloads,
        tags: search?.tags ?? [],
        links: {
          nugetPage: `https://www.nuget.org/packages/${query.packageId}`,
          projectSite: search?.projectUrl,
          license: licenseUrl ? { url: licenseUrl, expression: expressionMatch?.[1] } : undefined,
        },
        versions,
        latestStable: versions.find((v) => !v.isPrerelease)?.version,
        latestIncludingPrerelease: versions[0]?.version,
        fetchStatus: "Ok",
      };
    } catch (error) {
      const kind = error instanceof NuGetApiError ? error.kind : "Offline";
      if (!(error instanceof NuGetApiError)) {
        this.logger.Error("Unexpected NuGet API failure", error as Error);
      }
      return {
        id: query.packageId,
        verified: false,
        isMicrosoft: false,
        authors: "",
        tags: [],
        links: { nugetPage: `https://www.nuget.org/packages/${query.packageId}` },
        versions: [],
        fetchStatus: kind,
      };
    }
  }

  /**
   * Checks if the package is published by Microsoft based on its owners and authors.
   * @param owners The list of owners of the package, if available.
   * @param authors The authors of the package, if available.
   * @returns True if the package is published by Microsoft, false otherwise.
   */
  private isMicrosoftPublisher(owners: string[] | undefined, authors: string | undefined): boolean {
    const ownerTokens = (owners ?? []).map((o) => o.trim().toLowerCase()).filter(Boolean);
    const authorTokens = (authors ?? "")
      .split(/[,;]/)
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
    return ownerTokens.includes("microsoft") || authorTokens.includes("microsoft");
  }

  private toVersionInfo(
    leaf: RegistrationLeaf,
    projectTfms: Map<string, string[]>,
  ): PackageVersionInfoDto {
    const packageFrameworks = leaf.dependencyGroups
      .map((g) => g.targetFramework)
      .filter((tfm) => tfm.length > 0);

    const verdictsByProject: ProjectVerdictDto[] = [...projectTfms.entries()].map(
      ([projectPath, tfms]) => this.projectVerdict(projectPath, tfms, packageFrameworks),
    );

    return {
      version: leaf.version,
      isPrerelease: leaf.version.includes("-"),
      publishedUtc: leaf.publishedUtc,
      dependencyGroups: leaf.dependencyGroups,
      verdictsByProject,
    };
  }

  private projectVerdict(
    projectPath: string,
    tfms: string[],
    packageFrameworks: string[],
  ): ProjectVerdictDto {
    if (tfms.length === 0) {
      return { projectPath, verdict: "Unknown", reason: "project TFM not resolved" };
    }
    // For multi-TFM projects, the worst verdict takes precedence (Incompatible > Unknown > Compatible)
    const rank: Record<CompatibilityVerdict, number> = {
      Compatible: 0,
      Unknown: 1,
      Incompatible: 2,
    };
    let worst: ProjectVerdictDto = { projectPath, verdict: "Compatible" };
    for (const tfm of tfms) {
      const result = this.compatibility.isCompatible(tfm, packageFrameworks);
      if (rank[result.verdict] > rank[worst.verdict]) {
        worst = {
          projectPath,
          verdict: result.verdict,
          ...(result.reason ? { reason: result.reason } : {}),
        };
      }
    }
    return worst;
  }
}
