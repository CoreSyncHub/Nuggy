import { injectable } from "tsyringe";
import { ProjectTfmResolutionService } from "@Infrastructure/Projects/ProjectTfmResolutionService";

import * as path from "path";
import { type IQueryHandler } from "@Shared/Abstractions/Messaging/IQueryHandler";
import { GetProjectsTfmQuery } from "@Shared/Features/Queries/GetProjectsTfmQuery";
import { type ProjectsTfmDto, type ProjectTfmDto } from "@Shared/Features/Dtos/ProjectTfmDto";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";

/**
 * Handler for GetProjectsTfmQuery
 * Returns the effective TFM for all projects in a solution
 */
@injectable()
@HandlerFor(GetProjectsTfmQuery)
export class GetProjectsTfmQueryHandler implements IQueryHandler<
  GetProjectsTfmQuery,
  ProjectsTfmDto
> {
  constructor(private readonly tfmResolution: ProjectTfmResolutionService) {}

  async Handle(query: GetProjectsTfmQuery): Promise<ProjectsTfmDto> {
    const solutionPath = query.solutionPath;

    const { resolvedTfms } = await this.tfmResolution.resolveSolution(solutionPath);

    const projectDtos: ProjectTfmDto[] = [];
    for (const [projectPath, resolvedTfm] of resolvedTfms) {
      const projectName = path.basename(projectPath, ".csproj");

      projectDtos.push({
        projectPath,
        projectName,
        targetFrameworks: resolvedTfm.targetFrameworks,
        isMultiTargeting: resolvedTfm.isMultiTargeting,
        primaryTargetFramework: resolvedTfm.primaryTargetFramework,
        source: resolvedTfm.source,
        sdkType: resolvedTfm.sdkType,
        sdk: resolvedTfm.sdk,
      });
    }

    const sdkStyleProjects = projectDtos.filter((p) => p.sdkType === "SDK-Style").length;
    const legacyProjects = projectDtos.filter((p) => p.sdkType === "Legacy").length;
    const multiTargetingProjects = projectDtos.filter((p) => p.isMultiTargeting).length;

    const allTfms = new Set<string>();
    for (const project of projectDtos) {
      for (const tfm of project.targetFrameworks) {
        allTfms.add(tfm);
      }
    }

    return {
      projects: projectDtos,
      summary: {
        totalProjects: projectDtos.length,
        sdkStyleProjects,
        legacyProjects,
        multiTargetingProjects,
        uniqueTargetFrameworks: Array.from(allTfms).sort(),
      },
    };
  }
}
