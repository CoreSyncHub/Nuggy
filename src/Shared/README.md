# Architecture Partagée - Dispatcher & Bus

Ce dossier contient tous les éléments partagés entre le **Host** (Node.js) et la **WebView** (navigateur), permettant une communication transparente via le pattern Mediator/CQRS.

## Architecture

### Structure des dossiers

```
Shared/
├── Abstractions/           # Interfaces et contrats
│   ├── Messaging/          # IDispatcher, IBus, IRequest, etc.
│   └── Behaviors/          # IPipelineBehavior
├── Infrastructure/         # Implémentations concrètes
│   └── Messaging/          # Dispatcher, HandlerRegistry
├── DependencyInjection/    # Base provider pour DI
└── InjectionToken.ts       # Token d'injection typé
```

### Composants principaux

#### 1. **IBus** - Abstraction de transport
Responsable de router les requêtes vers leurs handlers, que ce soit localement ou à distance.

- **LocalBus** (Host): Exécute les handlers en local via le conteneur DI
- **RemoteBus** (WebView): Envoie les requêtes au Host via `postMessage`

#### 2. **IDispatcher** - Point d'entrée unifié
Interface unique pour envoyer des commandes et queries, indépendamment de l'environnement.

#### 3. **IRequest<TResponse>** - Marqueur de requête
Interface de base pour toutes les commandes et queries.

## Utilisation

### Côté Host - Créer une Query

```typescript
// 1. Définir la Query
import { IQuery } from '../../../Shared/Abstractions/Messaging/IQuery';

export class GetConfigQuery implements IQuery<SolutionConfig> {}

// 2. Créer le Handler
import { IQueryHandler } from '../../../Shared/Abstractions/Messaging/IQueryHandler';
import { HandlerFor } from '../../../Shared/Infrastructure/Messaging/HandlerFor';
import { injectable } from 'tsyringe';

@injectable()
@HandlerFor(GetConfigQuery)
export class GetConfigQueryHandler implements IQueryHandler<GetConfigQuery, SolutionConfig> {
  async Handle(query: GetConfigQuery): Promise<SolutionConfig> {
    // Votre logique ici
    return config;
  }
}

// 3. Enregistrer le Handler dans le DI
// Dans ApplicationDependencyInjection.ts
container.register(GetConfigQueryHandler, { useClass: GetConfigQueryHandler });
```

### Côté WebView - Utiliser la Query

```typescript
import { container } from 'tsyringe';
import { DISPATCHER } from '../../Shared/Abstractions/Messaging/IDispatcher';
import { GetConfigQuery } from '../../Host/Application/Queries/GetConfigQuery';

// Résoudre le dispatcher depuis le conteneur
const dispatcher = container.resolve(DISPATCHER.toString());

// Envoyer la query - elle sera automatiquement routée au Host via RemoteBus
const config = await dispatcher.Send(new GetConfigQuery());
console.log('Config reçue:', config);
```

### Côté Host - Utiliser localement

```typescript
import { container } from 'tsyringe';
import { DISPATCHER } from '../../Shared/Abstractions/Messaging/IDispatcher';
import { GetConfigQuery } from './Queries/GetConfigQuery';

// Résoudre le dispatcher
const dispatcher = container.resolve(DISPATCHER.toString());

// Envoyer la query - elle sera exécutée localement via LocalBus
const config = await dispatcher.Send(new GetConfigQuery());
console.log('Config:', config);
```

## Communication transparente

Le système est totalement transparent :

1. **WebView** → `dispatcher.Send(query)` → **RemoteBus** → `postMessage`
2. **Host WebMediator** → Reçoit le message → **Dispatcher** → **LocalBus**
3. **LocalBus** → Résout le handler → Exécute → Retourne la réponse
4. **Host** → `postMessage` (réponse) → **RemoteBus** → Résout la Promise
5. **WebView** → Reçoit la réponse

## Configuration DI

### Host (Infrastructure DI)
```typescript
this.Register<IBus>(BUS, LocalBus);        // Exécution locale
this.Register<IDispatcher>(DISPATCHER, Dispatcher);
```

### WebView (Web DI)
```typescript
this.Register<IBus>(BUS, RemoteBus);       // Communication distante
this.Register<IDispatcher>(DISPATCHER, Dispatcher);
```

## Avantages

✅ **Transparence**: Le code métier ne sait pas s'il est dans le Host ou la WebView
✅ **Testabilité**: Facile de mocker le Bus ou le Dispatcher
✅ **Type-safety**: Tout est typé avec TypeScript
✅ **Extensibilité**: Facile d'ajouter des behaviors (logging, validation, etc.)
✅ **Séparation des responsabilités**: Chaque couche a sa responsabilité claire

## Pipeline de Behaviors

Vous pouvez ajouter des behaviors pour intercepter les requêtes :

```typescript
import { IPipelineBehavior } from '../../Shared/Abstractions/Behaviors/IPipelineBehavior';
import { Behavior } from '../../Shared/Abstractions/Behaviors/Behavior';

@Behavior()
@injectable()
export class LoggingBehavior<TRequest, TResponse>
  implements IPipelineBehavior<TRequest, TResponse> {

  async Handle(
    request: TRequest,
    next: RequestHandlerDelegate<TResponse>
  ): Promise<TResponse> {
    console.log('Executing:', request.constructor.name);
    const response = await next();
    console.log('Completed:', request.constructor.name);
    return response;
  }
}
```

Les behaviors sont exécutés dans l'ordre où ils sont enregistrés dans `behaviorsMap`.
