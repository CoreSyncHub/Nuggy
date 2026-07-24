import { GetPackageManagementDiagnosticQueryHandler } from "@Application/Handlers/Packages/GetPackageManagementDiagnosticQueryHandler";
import { GetProjectsTfmQueryHandler } from "@Application/Handlers/Projects/GetProjectsTfmQueryHandler";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { PackageReferenceParser } from "@Infrastructure/Packages/PackageReferenceParser";
import { PackagesConfigParser } from "@Infrastructure/Packages/PackagesConfigParser";
import { PackageVersionParser } from "@Infrastructure/Packages/PackageVersionParser";
import { CpmDiagnosticService } from "@Infrastructure/Packages/CpmDiagnosticService";
import { PackageManagementDiagnosticService } from "@Infrastructure/Packages/PackageManagementDiagnosticService";
import { CsprojParser } from "@Infrastructure/Projects/CsprojParser";
import { TfmResolver } from "@Infrastructure/Projects/TfmResolver";
import { ILogger } from "@/Host/Application/Abstractions/Log/ILogger";

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
  const packageManagementDiagnosticService = new PackageManagementDiagnosticService(cpmDiagnosticService);

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

export function createTfmHandler(): GetProjectsTfmQueryHandler {
  const slnParser = new SlnParser();
  const slnxParser = new SlnxParser();
  const buildConfigDetector = new BuildConfigDetector();
  const buildConfigParser = new BuildConfigParser(noOpLogger);
  const csprojParser = new CsprojParser();
  const tfmResolver = new TfmResolver(csprojParser, noOpLogger);

  return new GetProjectsTfmQueryHandler(slnParser, slnxParser, buildConfigDetector, buildConfigParser, tfmResolver);
}
