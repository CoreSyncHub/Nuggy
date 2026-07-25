export type CompatibilityVerdict = 'Compatible' | 'Incompatible' | 'Unknown';
export type PackageFetchStatus = 'Ok' | 'Offline' | 'NotFound' | 'RateLimited';

export interface PackageDependencyDto {
  id: string;
  versionRange: string;
}

export interface DependencyGroupDto {
  targetFramework: string;
  dependencies: PackageDependencyDto[];
}

export interface ProjectVerdictDto {
  projectPath: string;
  verdict: CompatibilityVerdict;
  reason?: string;
}

export interface PackageVersionInfoDto {
  version: string;
  isPrerelease: boolean;
  publishedUtc?: string;
  dependencyGroups: DependencyGroupDto[];
  verdictsByProject: ProjectVerdictDto[];
}

export interface PackageLinksDto {
  nugetPage: string;
  projectSite?: string;
  license?: { url?: string; expression?: string };
}

export interface PackageUpdateInfoDto {
  id: string;
  verified: boolean;
  isMicrosoft: boolean;
  authors: string;
  publishedUtc?: string;
  totalDownloads?: number;
  tags: string[];
  links: PackageLinksDto;
  versions: PackageVersionInfoDto[];
  latestStable?: string;
  latestIncludingPrerelease?: string;
  fetchStatus: PackageFetchStatus;
}
