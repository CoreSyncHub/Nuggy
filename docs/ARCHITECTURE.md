# Architecture de Communication Host ↔ WebView

## Vue d'ensemble

Cette extension VSCode utilise un système de **Dispatcher/Bus** pour permettre une communication transparente entre le Host (Node.js) et la WebView (navigateur).

## Schéma d'architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         WebView                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Code métier                                          │   │
│  │  dispatcher.Send(new GetConfigQuery())               │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                          │                                   │
│  ┌───────────────────────▼──────────────────────────────┐   │
│  │  Dispatcher (Shared)                                  │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                          │                                   │
│  ┌───────────────────────▼──────────────────────────────┐   │
│  │  RemoteBus                                            │   │
│  │  - Sérialise la requête                              │   │
│  │  - Génère un CorrelationId                           │   │
│  │  - Envoie via postMessage                            │   │
│  │  - Attend la réponse (Promise)                       │   │
│  └───────────────────────┬──────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────┘
                             │ postMessage (REQUEST)
                             │ { Headers: { Type, Command, CorrelationId }, Body }
┌────────────────────────────▼────────────────────────────────┐
│                         Host (Node.js)                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  WebMediator                                          │   │
│  │  - Écoute les messages de la WebView                │   │
│  │  - Reconstruit la requête                            │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                          │                                   │
│  ┌───────────────────────▼──────────────────────────────┐   │
│  │  Dispatcher (Shared)                                  │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                          │                                   │
│  ┌───────────────────────▼──────────────────────────────┐   │
│  │  LocalBus                                             │   │
│  │  - Résout le handler depuis handlersMap             │   │
│  │  - Résout l'instance depuis le conteneur DI         │   │
│  │  - Exécute les behaviors (logging, validation...)   │   │
│  │  - Appelle handler.Handle(request)                   │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                          │                                   │
│  ┌───────────────────────▼──────────────────────────────┐   │
│  │  GetConfigQueryHandler                                │   │
│  │  async Handle(query): Promise<SolutionConfig>        │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                          │                                   │
│                          │ Réponse                           │
│  ┌───────────────────────▼──────────────────────────────┐   │
│  │  WebMediator                                          │   │
│  │  - Enveloppe la réponse                              │   │
│  │  - Envoie via postMessage                            │   │
│  └───────────────────────┬──────────────────────────────┘   │
└────────────────────────────┼────────────────────────────────┘
                             │ postMessage (RESPONSE)
                             │ { Headers: { Type, Command, CorrelationId }, Body }
┌────────────────────────────▼────────────────────────────────┐
│                         WebView                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  RemoteBus                                            │   │
│  │  - Reçoit la réponse                                 │   │
│  │  - Trouve la Promise via CorrelationId               │   │
│  │  - Résout la Promise avec la réponse                │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                          │                                   │
│  ┌───────────────────────▼──────────────────────────────┐   │
│  │  Code métier                                          │   │
│  │  const config = await ...                            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Structure des dossiers

```
src/
├── Shared/                      # Code réutilisable
│   ├── Abstractions/
│   │   ├── Messaging/           # IDispatcher, IBus, IRequest...
│   │   └── Behaviors/           # IPipelineBehavior
│   ├── DependencyInjection/     # Helpers DI partagés
│   ├── Infrastructure/
│   │   └── Messaging/           # Dispatcher, HandlerRegistry
│   ├── Features/                # Commands / Queries / Events / Dtos partagés
│   │   ├── Commands/
│   │   ├── Dtos/
│   │   ├── Queries/
│   │   └── Events/
│   └── InjectionToken.ts
│
├── Host/                        # Backend Node.js
│   ├── Domain/                  # Modèles métier
│   ├── Application/
│   │   ├── DependencyInjection.ts
│   │   ├── Abstractions/         # Abstractions spécifiques au Host
│   │   │   └── .../
│   │   └── Handlers/             # Handlers de requêtes/commandes
│   │       ├── Language/
│   │       │   └── GetLanguageQueryHandler.ts
│   │       └── Solution
│   │           └── GetSolutionQueryHandler.ts
│   ├── Infrastructure/
│   │   ├── DependencyInjection.ts
│   │   └── Messaging/
│   │       └── LocalBus.ts      # Exécution locale
│   └── Presentation/
│       ├── Program.ts           # Point d'entrée, initialise DI
│       └── WebMediator.ts       # Reçoit les messages de la WebView
│
└── Web/
    ├── Core/                           # Infrastructure fondamentale
    │   ├── DI/
    │   │   └── WebDependencyInjection.ts
    │   ├── Services/                   # Services métier avec DI
    │   │   ├── PackageService.ts
    │   │   └── StateService.ts
    │   └── Infrastructure/
    │       └── Messaging/
    │           └── RemoteBus.ts
    │
    ├── i18n/
    │   └── locales/                    # Fichiers de traduction JSON
    │       ├── en.json
    │       └── fr.json
    │
    ├── Features/                       # Features par domaine métier
    │   ├── Packages/
    │   │   ├── Components/             # Lit Components avec DI
    │   │   │   ├── PackageList.ts
    │   │   │   ├── PackageCard.ts
    │   │   │   └── PackageDetails.ts
    │   │   ├── Services/
    │   │   │   └── PackageUIService.ts
    │   │   └── Models/
    │   │       └── PackageViewModel.ts
    │   └── Projects/
    │       └── Components/
    │           └── ProjectList.ts
    │
    ├── Shared/                         # Code réutilisable
    │   ├── Components/                 # Composants génériques
    │   │   ├── BaseComponent.ts        # Base pour tous les composants
    │   │   ├── LoadingSpinner.ts
    │   │   └── EmptyState.ts
    │   ├── Utils/
    │   │   └── formatters.ts           # Utilitaires purs
    │   └── Icons/
    │
    ├── App.ts                          # Initialisation de l'application
    └── Main.ts                         # Bootstrap
```

## Exemple d'utilisation

### 1. Créer une Query (Shared)

```typescript
// src/Shared/Features/Queries/GetPackageInfoQuery.ts
import { IQuery } from '../../../Shared/Abstractions/Messaging/IQuery';

export class GetPackageInfoQuery implements IQuery<PackageInfo> {
  constructor(public readonly packageId: string) {}
}
```

### 2. Créer le Handler (Host)

```typescript
// src/Host/Application/Handlers/Packages/GetPackageInfoQueryHandler.ts
import { IQueryHandler } from '../../../Shared/Abstractions/Messaging/IQueryHandler';
import { HandlerFor } from '../../../Shared/Infrastructure/Messaging/HandlerFor';
import { injectable, inject } from 'tsyringe';

@injectable()
@HandlerFor(GetPackageInfoQuery)
export class GetPackageInfoQueryHandler implements IQueryHandler<GetPackageInfoQuery, PackageInfo> {
  constructor(@inject(NUGET_API.toString()) private nugetApi: INuGetApi) {}

  async Handle(query: GetPackageInfoQuery): Promise<PackageInfo> {
    return await this.nugetApi.getPackageInfo(query.packageId);
  }
}
```

### 3. Enregistrer le Handler (Host)

```typescript
// src/Host/Application/DependencyInjection.ts
container.register(GetPackageInfoQueryHandler, {
  useClass: GetPackageInfoQueryHandler,
});
```

### 4. Utiliser depuis la WebView

```typescript
// src/Web/components/package-card.ts
import { container } from 'tsyringe';
import { DISPATCHER } from '../../../Shared/Abstractions/Messaging/IDispatcher';
import { GetPackageInfoQuery } from '../../../Host/Application/Queries/GetPackageInfoQuery';

async function loadPackageInfo(packageId: string) {
  const dispatcher = container.resolve(DISPATCHER.toString());

  // Appel transparent - sera exécuté sur le Host !
  const packageInfo = await dispatcher.Send(new GetPackageInfoQuery(packageId));

  console.log('Package info:', packageInfo);
}
```

## 5. Enregistrement des requêtes dans WebMediator

Pour que WebMediator puisse reconstruire les instances de requêtes depuis JSON, vous devez enregistrer les types :

```typescript
// src/Host/Presentation/nugetWebviewProvider.ts
const webMediator = new WebMediator(webviewView.webview, dispatcher);

// Enregistrer les types de requêtes
webMediator.registerRequestType('GetConfigQuery', GetConfigQuery);
webMediator.registerRequestType('GetPackageInfoQuery', GetPackageInfoQuery);
```

## Avantages de cette architecture

1. **Transparence totale** : Le code WebView ne sait pas qu'il communique avec le Host
2. **Type-safety** : Tout est typé, pas de magie de strings
3. **Testabilité** : Facile de mocker le Bus ou le Dispatcher
4. **Découplage** : Le Dispatcher ne connaît pas le Bus, le Bus ne connaît pas le transport
5. **Extensibilité** : Facile d'ajouter des behaviors (cache, logging, validation, retry...)
6. **Réutilisabilité** : Les queries/commands peuvent être utilisées partout

## Format des messages

### REQUEST

```json
{
  "Headers": {
    "Type": "REQUEST",
    "Command": "GetConfigQuery",
    "CorrelationId": 12345
  },
  "Body": {
    // Propriétés de la requête sérialisées
  }
}
```

### RESPONSE

```json
{
  "Headers": {
    "Type": "RESPONSE",
    "Command": "GetConfigQuery",
    "CorrelationId": 12345
  },
  "Body": {
    // Réponse du handler
    // ou { "__error": "message d'erreur" }
  }
}
```

## Pipeline de Behaviors

Les behaviors permettent d'intercepter toutes les requêtes pour ajouter des fonctionnalités transversales :

```typescript
@Behavior()
@injectable()
export class LoggingBehavior<TRequest, TResponse>
  implements IPipelineBehavior<TRequest, TResponse>
{
  async Handle(
    request: TRequest,
    next: RequestHandlerDelegate<TResponse>,
    cancellationToken?: CancellationToken
  ): Promise<TResponse> {
    const start = Date.now();
    console.log(`[${request.constructor.name}] Starting...`);

    try {
      const response = await next(cancellationToken);
      console.log(`[${request.constructor.name}] Completed in ${Date.now() - start}ms`);
      return response;
    } catch (error) {
      console.error(`[${request.constructor.name}] Failed:`, error);
      throw error;
    }
  }
}
```

Enregistrez-le dans le DI :

```typescript
container.register(LoggingBehavior, { useClass: LoggingBehavior });
```

Les behaviors sont automatiquement appliqués à toutes les requêtes exécutées via LocalBus.
