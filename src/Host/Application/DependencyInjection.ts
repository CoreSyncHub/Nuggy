import { DependencyInjectionProvider } from '@Shared/DependencyInjection/DependencyInjectionProvider';
import { Dispatcher } from '@Shared/Infrastructure/Messaging/Dispatcher';
import { DISPATCHER, type IDispatcher } from '@Shared/Abstractions/Messaging/IDispatcher';
import { GetLanguageQueryHandler } from './Handlers/Language/GetLanguageQueryHandler';
import { GetWorkspaceSolutionsQueryHandler } from './Handlers/Solution/GetWorkspaceSolutionsQueryHandler';
import { GetSolutionStructureQueryHandler } from './Handlers/Solution/GetSolutionStructureQueryHandler';
import { SelectSolutionCommandHandler } from './Handlers/Solution/SelectSolutionCommandHandler';
import { GetBuildConfigurationFilesQueryHandler } from './Handlers/Build/GetBuildConfigurationFilesQueryHandler';
import { GetProjectsTfmQueryHandler } from './Handlers/Projects/GetProjectsTfmQueryHandler';
import { GetPackageManagementDiagnosticQueryHandler } from './Handlers/Packages/GetPackageManagementDiagnosticQueryHandler';
import { GetSolutionPackagesQueryHandler } from './Handlers/Packages/GetSolutionPackagesQueryHandler';
import { GetPackageUpdateInfoQueryHandler } from './Handlers/Packages/GetPackageUpdateInfoQueryHandler';

export class ApplicationDependencyInjection extends DependencyInjectionProvider {
  public Provide(): void {
    this.ProvideMediator();
    this.ProvideLanguage();
    this.ProvideSolution();
    this.ProvideBuild();
    this.ProvideProjects();
    this.ProvidePackages();
  }

  private ProvideMediator(): void {
    this.Register<IDispatcher>(DISPATCHER, Dispatcher);
  }

  private ProvideLanguage(): void {
    this.RegisterClass(GetLanguageQueryHandler);
  }

  private ProvideSolution(): void {
    this.RegisterClass(GetWorkspaceSolutionsQueryHandler);
    this.RegisterClass(GetSolutionStructureQueryHandler);
    this.RegisterClass(SelectSolutionCommandHandler);
  }

  private ProvideBuild(): void {
    this.RegisterClass(GetBuildConfigurationFilesQueryHandler);
  }

  private ProvideProjects(): void {
    this.RegisterClass(GetProjectsTfmQueryHandler);
  }

  private ProvidePackages(): void {
    this.RegisterClass(GetPackageManagementDiagnosticQueryHandler);
    this.RegisterClass(GetSolutionPackagesQueryHandler);
    this.RegisterClass(GetPackageUpdateInfoQueryHandler);
  }
}
