/**
 * DTO representing the resolved TFM information for a project
 */
export interface ProjectTfmDto {
  /** Absolute path to the .csproj file */
  projectPath: string;

  /** Project name */
  projectName: string;

  /** The effective target framework(s) */
  targetFrameworks: string[];

  /** Indicates if the project is multi-targeting */
  isMultiTargeting: boolean;

  /** Primary/default target framework (first in the list) */
  primaryTargetFramework: string;

  /** Source of the TFM (where it was defined) */
  source: '.csproj' | 'Directory.Build.targets' | 'Directory.Build.props' | 'Not Found';

  /** SDK type of the project */
  sdkType: 'SDK-Style' | 'Legacy' | 'Unknown';

  /** SDK attribute value (for SDK-style projects) */
  sdk?: string;
}

/**
 * DTO representing TFM information for multiple projects
 */
export interface ProjectsTfmDto {
  /** TFM information per project */
  projects: ProjectTfmDto[];

  /** Summary statistics */
  summary: {
    totalProjects: number;
    sdkStyleProjects: number;
    legacyProjects: number;
    multiTargetingProjects: number;
    uniqueTargetFrameworks: string[];
  };
}
