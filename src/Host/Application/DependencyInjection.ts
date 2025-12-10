import { DependencyInjectionProvider } from '@Shared/DependencyInjection/DependencyInjectionProvider';
import { Dispatcher } from '@Shared/Infrastructure/Messaging/Dispatcher';
import { DISPATCHER, IDispatcher } from '@Shared/Abstractions/Messaging/IDispatcher';
import { GetLanguageQueryHandler } from './Handlers/Language/GetLanguageQueryHandler';
import { GetWorkspaceSolutionsQueryHandler } from './Handlers/Solution/GetWorkspaceSolutionsQueryHandler';
import { GetSolutionStructureQueryHandler } from './Handlers/Solution/GetSolutionStructureQueryHandler';
import { SelectSolutionCommandHandler } from './Handlers/Solution/SelectSolutionCommandHandler';
import { container } from 'tsyringe';

export class ApplicationDependencyInjection extends DependencyInjectionProvider {
  public Provide(): void {
    this.Register<IDispatcher>(DISPATCHER, Dispatcher);

    // Language handlers
    container.register(GetLanguageQueryHandler, { useClass: GetLanguageQueryHandler });

    // Solution handlers
    container.register(GetWorkspaceSolutionsQueryHandler, {
      useClass: GetWorkspaceSolutionsQueryHandler,
    });
    container.register(GetSolutionStructureQueryHandler, {
      useClass: GetSolutionStructureQueryHandler,
    });
    container.register(SelectSolutionCommandHandler, {
      useClass: SelectSolutionCommandHandler,
    });
  }
}
