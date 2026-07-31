import { GetPackageManagementDiagnosticQueryHandler } from "@Application/Handlers/Packages/GetPackageManagementDiagnosticQueryHandler";
import { GetProjectsTfmQueryHandler } from "@Application/Handlers/Projects/GetProjectsTfmQueryHandler";
import { GetSolutionPackagesQueryHandler } from "@Application/Handlers/Packages/GetSolutionPackagesQueryHandler";
import { PackageWriteTargetResolver } from "@Infrastructure/MsBuild/PackageWriteTargetResolver";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { PackageReferenceParser } from "@Infrastructure/Packages/PackageReferenceParser";
import { PackagesConfigParser } from "@Infrastructure/Packages/PackagesConfigParser";
import { PackageVersionParser } from "@Infrastructure/Packages/PackageVersionParser";
import { CpmDiagnosticService } from "@Infrastructure/Packages/CpmDiagnosticService";
import { PackageManagementDiagnosticService } from "@Infrastructure/Packages/PackageManagementDiagnosticService";
import { NuGetConfigResolver } from "@Infrastructure/Packages/NuGetConfigResolver";
import { NuGetConfigParser } from "@Infrastructure/Packages/NuGetConfigParser";
import { CsprojParser } from "@Infrastructure/Projects/CsprojParser";
import { TfmResolver } from "@Infrastructure/Projects/TfmResolver";
import { ProjectTfmResolutionService } from "@Infrastructure/Projects/ProjectTfmResolutionService";
import { type ILogger } from "@/Host/Application/Abstractions/Log/ILogger";

const noOpLogger: ILogger = {
  Info: () => {},
  Warning: () => {},
  Error: () => {},
  Debug: () => {},
};

export function createDiagnosticHandler(): GetPackageManagementDiagnosticQueryHandler {
  const slnParser = new SlnParser();
  const slnxParser = new SlnxParser();
  const buildConfigDetector = new BuildConfigDetector();
  const buildConfigParser = new BuildConfigParser(noOpLogger);
  const packageReferenceParser = new PackageReferenceParser(noOpLogger);
  const packagesConfigParser = new PackagesConfigParser(noOpLogger);
  const packageVersionParser = new PackageVersionParser();
  const cpmDiagnosticService = new CpmDiagnosticService(packageVersionParser);
  const packageManagementDiagnosticService = new PackageManagementDiagnosticService(
    cpmDiagnosticService,
  );

  return new GetPackageManagementDiagnosticQueryHandler(
    slnParser,
    slnxParser,
    buildConfigDetector,
    buildConfigParser,
    packageReferenceParser,
    packagesConfigParser,
    packageManagementDiagnosticService,
  );
}

/** Composition partagée de la résolution de solution, utilisée par tous les handlers. */
function tfmResolution(): ProjectTfmResolutionService {
  return new ProjectTfmResolutionService(
    new SlnParser(),
    new SlnxParser(),
    new BuildConfigDetector(),
    new BuildConfigParser(noOpLogger),
    new TfmResolver(new CsprojParser(), noOpLogger),
  );
}

export function createTfmHandler(): GetProjectsTfmQueryHandler {
  return new GetProjectsTfmQueryHandler(tfmResolution());
}

export function createSolutionPackagesHandler(): GetSolutionPackagesQueryHandler {
  return new GetSolutionPackagesQueryHandler(
    tfmResolution(),
    new PackageReferenceParser(noOpLogger),
    new PackagesConfigParser(noOpLogger),
    new CpmDiagnosticService(new PackageVersionParser()),
    new NuGetConfigResolver(new NuGetConfigParser(noOpLogger)),
  );
}

export function createPackageWriteTargetResolver(): PackageWriteTargetResolver {
  return new PackageWriteTargetResolver(
    tfmResolution(),
    new PackageReferenceParser(noOpLogger),
    new PackagesConfigParser(noOpLogger),
    new CpmDiagnosticService(new PackageVersionParser()),
  );
}
