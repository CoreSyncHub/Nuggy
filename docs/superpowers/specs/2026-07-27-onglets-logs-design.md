# Onglets webview — Packages / Logs (historique des restores + journal des opérations)

**Date** : 2026-07-27 · **Statut** : validé en brainstorming · **Auteur** : Victor DELEAU + Claude

## Contexte

L'Epic 5 (mergé, PR #2) affiche le résultat du restore dans un bandeau au-dessus du détail
de package, avec les erreurs dépliables dans un `<details>`. Retour de Victor : afficher
des logs dans le contenu packages n'est ni ergonomique ni approprié. La webview doit
gagner des onglets : la gestion des packages dans **Packages**, les logs dans **Logs** ;
un clic sur un restore en échec navigue vers l'onglet Logs, positionné sur le run
concerné.

Aujourd'hui, la sortie complète de `dotnet restore` n'est visible que dans le canal
Output « NuGet Explorer » ; le `RestoreStatusDto` ne transporte que les lignes
`error NU\d+ / MSB\d+` du dernier run. Aucun historique n'est conservé, et les écritures
(install/upgrade/uninstall) ne laissent aucune trace consultable.

Les composants `fluent-tabs` / `fluent-tab` / `fluent-tab-panel` sont enregistrés dans
`Main.ts` depuis l'Epic 1 mais inutilisés.

## Périmètre

**Inclus** : coquille à onglets (Packages / Logs), historique borné des runs de restore
(sortie complète incluse), journal de session des opérations d'écriture, navigation
bandeau d'échec → onglet Logs scrollé sur le run, i18n fr/en des nouveaux libellés.

**Exclu** : persistance disque de l'historique (mémoire de session uniquement, perdu au
rechargement de la webview et de l'extension) ; canal push Host→Web (le modèle
request/response par query est conservé) ; filtres/recherche dans les logs ; export des
logs ; onglets supplémentaires (Settings, etc. — YAGNI).

## Décisions de cadrage

1. **Contenu de l'onglet Logs : restores + opérations** — un flux unique
   anté-chronologique mêlant les runs de restore (bloc repliable avec la sortie complète)
   et les opérations d'écriture (audit trail de session : quoi, quand, quels fichiers).
2. **Tampon mémoire borné côté Host** — 50 entrées FIFO, singleton, aucune persistance.
3. **Chargement à l'activation** — l'onglet Logs re-fetch à chaque activation et après
   chaque fin de restore observée par le polling existant ; pas de polling permanent.
4. **Le bandeau maigrit** — il reste dans Packages (état + première erreur + compte),
   mais les détails vivent dans Logs ; en échec il devient le point d'entrée de la
   navigation.

## Architecture

```
RestoreScheduler ──record──► OperationLogStore ◄──record── 3 handlers d'écriture
                                    │
GetOperationLogQuery ──────────────►│  (DI + WebMediator, comme les queries existantes)
                                    ▼
App.ts : <nuget-tabs>  ┌─ onglet Packages : <packages-view> (inchangé, bandeau allégé)
                       └─ onglet Logs     : <logs-view> (fetch à l'activation)

Bandeau échec (clic) ──event show-logs {runId}──► <nuget-tabs> active Logs
                                                  └─► <logs-view> déplie + scrolle le run
```

## Composants

### Host — `Infrastructure/MsBuild/OperationLogStore.ts` `@singleton()`

Tampon mémoire pur (zéro I/O), 50 entrées max, FIFO (la plus ancienne éjectée).
Deux types d'entrées, discriminés par `kind` :

- `RestoreRunEntry { kind: "restore", runId, solutionPath, startedUtc, finishedUtc?,
  status: "Running" | "Succeeded" | "Failed", exitCode?, output: string[],
  whyInsights: string[] }` — `output` = sortie complète dotnet, plafonnée à 500 lignes
  (les premières 500 ; une ligne finale « … sortie tronquée (N lignes) » si dépassement) ;
  `whyInsights` = blocs `dotnet nuget why` déjà produits par l'enrichissement Epic 5.
- `WriteOperationEntry { kind: "write", timestampUtc, operation: "install" | "upgrade"
  | "uninstall", packageId, version?, status: "Ok" | "Error", affectedProjects: string[],
  filesChanged: string[], skipped: { projectPath, reason }[], error? }`.

API : `recordRestoreStart(runId, solutionPath): void` (crée l'entrée Running),
`completeRestore(runId, { status, exitCode, output, whyInsights }): void` (complète
l'entrée existante ; runId inconnu → no-op silencieux), `recordWrite(entry): void`,
`getEntries(): OperationLogEntry[]` (copie triée anté-chronologique).

Producteurs :

- `RestoreScheduler.fire()` appelle `recordRestoreStart` au lancement et
  `completeRestore` à la fin (succès, échec, timeout, catch) — il détient déjà runId,
  sortie complète et enrichissement why.
- Les trois handlers d'écriture appellent `recordWrite` juste avant de retourner leur
  DTO (données identiques à celles du DTO + horodatage + operation/packageId/version).

### Contrat — `GetOperationLogQuery`

```
GetOperationLogQuery {}  →  OperationLogDto { entries: OperationLogEntryDto[] }

OperationLogEntryDto = RestoreRunEntryDto | WriteOperationEntryDto  (champ « kind »)
```

Handler `GetOperationLogQueryHandler` dans `Application/Handlers/Packages/`, enregistré
DI (`ProvidePackages`) + WebMediator (`registerRequestType`). Les horodatages sont des
chaînes ISO UTC ; le formatage local (dates, durées) est fait côté Web.

### Web — coquille à onglets

- `App.ts` rend un nouveau composant `<nuget-tabs>` (`Web/Features/Shell/NugetTabs.ts`)
  qui utilise les `fluent-tabs` déjà enregistrés : deux onglets, Packages (défaut) et
  Logs. L'état « onglet actif » vit dans `<nuget-tabs>`. Les deux panneaux restent
  montés (pas de destruction au changement d'onglet — l'état de `<packages-view>`,
  sélection et splitter, est préservé).
- `<nuget-tabs>` écoute l'événement `show-logs` (composed, bubbling) émis par le bandeau :
  il active l'onglet Logs et transmet le `runId` à `<logs-view>`.

### Web — `<logs-view>` (`Web/Features/Logs/LogsView.ts`)

- Fetch `GetOperationLogQuery` à chaque activation de l'onglet. En complément,
  `<packages-view>` émet un nouvel événement `restore-finished` (composed, bubbling)
  quand son polling existant observe un état terminal ; `<nuget-tabs>` le relaie à
  `<logs-view>`, qui re-fetch si l'onglet Logs est actif.
- Rendu : liste anté-chronologique de cartes. Restore : en-tête (icône statut SVG
  existante, horodatage, durée, solution) + `<details>` avec la sortie complète et les
  blocs why. Écriture : ligne compacte (icône opération, packageId@version, statut,
  projets affectés) + `<details>` avec fichiers modifiés et skipped.
- Ciblage : quand un `runId` est transmis via `show-logs`, la carte correspondante est
  dépliée et scrollée en vue (`scrollIntoView`), avec un bref surlignage. runId absent
  de la liste (tampon purgé) → simple activation de l'onglet, sans erreur.
- Liste vide → état vide avec message (« Aucune activité pour le moment »).

### Web — bandeau allégé (`WriteStatusBanner.ts`)

- Conserve : spinner Running, ✔ Succeeded (auto-hide 4 s), ✖ Failed persistant avec la
  **première** ligne d'erreur + « +N autres erreurs », affichage des skipped/erreurs
  d'écriture (résultat d'action, pas du log).
- Supprime : le `<details>` de logs.
- En échec : le bandeau devient cliquable (`cursor: pointer`, libellé « Voir les
  logs → ») et émet `show-logs { runId }`.

### i18n

Nouvelles clés fr/en : `tabs.packages`, `tabs.logs`, `logs.empty`, `logs.viewLogs`
(« Voir les logs »), `logs.restoreRun`, `logs.truncated`, `logs.operation.install/
upgrade/uninstall`, `logs.filesChanged`, `logs.skipped`. Les locales de/es restent en
retard (backlog existant).

## Gestion d'erreurs

- `OperationLogStore` ne jette jamais : entrées mal formées ignorées, `completeRestore`
  sur runId inconnu = no-op.
- L'enregistrement au log ne doit jamais faire échouer l'opération métier : les appels
  `recordWrite` / `completeRestore` sont dans le flux normal mais le store est pur et
  sans I/O — pas de try/catch nécessaire au-delà de son contrat « ne jette jamais ».
- `GetOperationLogQuery` sur tampon vide → `{ entries: [] }`.

## Tests

Conventions existantes : fixtures POSIX, pas de réseau ni process réel, fake timers pour
le scheduler.

- `OperationLogStore` : bornage FIFO à 50, ordre anté-chronologique, cap 500 lignes +
  ligne de troncature, cycle recordRestoreStart→completeRestore, completeRestore sur
  runId inconnu, copie défensive de `getEntries`.
- `RestoreScheduler` : les tests existants s'enrichissent — un run enregistre
  start+complete dans le store (succès, échec, timeout, exception du runner).
- Handlers d'écriture : chaque handler enregistre une `WriteOperationEntry` cohérente
  avec son DTO (extension des suites existantes).
- `GetOperationLogQueryHandler` : mapping entrées → DTO.
- Acceptance : extension de `PackageWrites.acceptance.test.ts` — après
  install→upgrade→uninstall + restores, `GetOperationLogQuery` retourne le journal
  attendu (3 écritures + les runs, ordre correct).
- UI hors Jest ; vérification manuelle F5 en fin de plan : onglets, navigation depuis le
  bandeau d'échec, scroll/dépliage sur le bon run, état préservé de Packages.
