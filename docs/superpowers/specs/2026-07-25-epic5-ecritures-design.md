# Epic 5 (recentré) — Écritures de packages : installer, mettre à jour, désinstaller

**Date** : 2026-07-25 · **Statut** : validé en brainstorming · **Auteur** : Victor DELEAU + Claude

## Contexte

L'Epic 2 (mergé, PR #1) fournit la vue maître-détail en lecture seule : liste consolidée,
verdicts de compatibilité TFM par version × projet, boutons d'action présents mais
désactivés. Le `referenceStyle` de chaque installation distingue déjà
`PackageReference` / `CpmManaged` / `PackagesConfig`. Aucune capacité d'écriture MSBuild
n'existe ; le parsing XML (fast-xml-parser) est lecture seule — un round-trip
parse→rebuild détruirait formatage et commentaires.

Cet epic active les boutons : écritures réelles dans les `.csproj` et
`Directory.Packages.props`, suivies d'un `dotnet restore` automatique dont le résultat
remonte dans l'UI. La recherche de packages non installés est reportée à l'epic suivant.
Ordre choisi car la brique d'écriture est le prérequis de toute la vision (migration CPM,
auto-upgrade TFM).

## Périmètre

**Inclus** : install/upgrade/uninstall par projet et globaux, sémantique CPM native
simple, restore automatique débouncé avec statut dans l'UI, invalidation des caches,
confirmations sur les actions globales.

**Exclu** : recherche de nouveaux packages (epic suivant) ; écritures dans
`packages.config` (projets legacy en lecture seule, boutons désactivés avec tooltip
« projet legacy — migrez vers PackageReference ») ; `VersionOverride` (l'upgrade par
projet d'un package CPM est désactivé, tooltip « géré centralement ») ; wildcards de
version (`8.*` → upgrade refusé avec message) ; éléments `Update=` (seuls les `Include=`
sont gérés) ; références issues d'imports/props indirects ; rollback automatique sur
échec de restore (l'écriture reste, l'utilisateur voit les erreurs).

## Décisions de cadrage

1. **Mécanique d'écriture : chirurgie textuelle** — édition ciblée du texte brut,
   formatage garanti intact. Pas de délégation à `dotnet add/remove` (dépendance SDK par
   opération, support CPM inégal, sortie à parser).
2. **Legacy lecture seule** — la migration packages.config→PackageReference sera une
   fonctionnalité dédiée d'un epic ultérieur.
3. **CPM natif simple** — upgrade = solution-wide via `<PackageVersion>` (l'UI annonce
   « affectera N projets ») ; install = `<PackageReference>` sans Version + création du
   `<PackageVersion>` manquant dans le Directory.Packages.props le plus proche ;
   uninstall = retrait de la référence + suppression du `<PackageVersion>` devenu
   orphelin (plus aucun projet consommateur).
4. **Restore automatique** — débouncé, jamais concurrent, résultat consultable par query.

## Architecture (approche retenue : commands CQRS fines)

```
UI (boutons existants) ──Command──► WebMediator ──► Handler
  Handler : 1. relit le fichier cible depuis le disque (jamais de cache)
            2. MsBuildTextEditor : édition chirurgicale (string → string)
            3. écriture atomique (contenu complet, un writeFileSync par fichier)
            4. invalide PackageMetadataCache(id) + ProjectTfmCache(solution)
            5. RestoreScheduler.schedule(solution)
            → PackageWriteResultDto immédiat
UI : recharge GetSolutionPackagesQuery + re-fetch du package touché,
     puis polling GetRestoreStatusQuery (1 s, 60 s max) pour le bandeau restore
```

L'écriture est synchrone et rapide ; le restore est asynchrone et débouncé (300 ms) :
une action globale sur N projets produit N écritures et UN restore. Pas de canal push
Host→Web (hors périmètre) : le statut restore est un singleton interrogé par query.

## Composants

| Composant | Rôle |
|---|---|
| `Infrastructure/MsBuild/MsBuildTextEditor` `@singleton()` | Service pur (zéro I/O). Opérations : `setVersionAttribute`, `addItemElement`, `removeItemElement`, `findItemElement` — sur `PackageReference` et `PackageVersion`. Retour `{ ok, content } \| { ok: false, reason }`, jamais d'exception sur contenu inattendu, jamais d'écriture partielle. |
| `Infrastructure/MsBuild/RestoreScheduler` `@singleton()` | `schedule(solutionPath)` : débounce 300 ms, réarmé à chaque écriture ; si un restore court, le suivant attend la fin (jamais deux concurrents). `getStatus()` : `Idle → Running (dès schedule) → Succeeded \| Failed(messages)`, `runId` croissant, état terminal conservé jusqu'au prochain schedule. Spawn isolé derrière une interface `ProcessRunner` injectée (testable sans dotnet). |
| Exécution restore | `spawn('dotnet', ['restore', solutionPath])` ; stdout/stderr intégral vers le canal Output « NuGet Explorer » ; l'UI ne reçoit que exit code + lignes `error NU\d+` / `error MSB\d+` ; timeout 5 min → kill + Failed ; dotnet absent du PATH → Failed « SDK .NET introuvable » sans crash. |
| Handlers `Application/Handlers/Packages/` | `InstallPackageCommandHandler`, `UpgradePackageCommandHandler`, `UninstallPackageCommandHandler` — `@injectable()` + `@HandlerFor`, enregistrés DI + WebMediator. |

### Détail MsBuildTextEditor

- `setVersionAttribute` : localise l'élément (id insensible à la casse, ordre
  d'attributs et guillemets simples/doubles tolérés), remplace uniquement la valeur de
  `Version` — reste du fichier byte-identique.
- `addItemElement` : insertion dans l'`<ItemGroup>` contenant déjà des éléments du même
  type (après le dernier, ou triée alphabétiquement si l'existant est trié), sinon
  nouvel `<ItemGroup>` avant `</Project>` ; jamais dans un ItemGroup porteur d'une
  `Condition`. Indentation détectée sur les voisins, fins de ligne (CRLF/LF) et BOM
  UTF-8 préservés.
- `removeItemElement` : supprime la ligne ou le bloc (élément à métadonnées enfants) ;
  un `<ItemGroup>` devenu vide est supprimé avec ses lignes blanches adjacentes.
- `findItemElement` : offsets + attributs actuels, pour validation préalable des
  handlers.

## Contrats

```
InstallPackageCommand   { packageId, version, solutionPath, projectPath? }  // absent = tous les projets compatibles
UpgradePackageCommand   { packageId, version, solutionPath, projectPath? }  // absent = partout où installé
UninstallPackageCommand { packageId, solutionPath, projectPath? }           // absent = partout

PackageWriteResultDto {
  status: 'Ok' | 'Error',
  filesChanged: string[],
  affectedProjects: string[],
  skipped: { projectPath: string, reason: string }[],
  error?: string
}

GetRestoreStatusQuery → RestoreStatusDto {
  status: 'Idle' | 'Running' | 'Succeeded' | 'Failed',
  messages: string[], runId: number, finishedAtUtc?: string
}
```

### Sémantique par referenceStyle

| Opération | PackageReference | CpmManaged | PackagesConfig |
|---|---|---|---|
| Install | ajoute `<PackageReference Include Version>` | ajoute `<PackageReference Include>` sans Version + crée `<PackageVersion>` si absent | skipped « legacy » |
| Upgrade | remplace l'attribut Version | remplace la Version du `<PackageVersion>` (solution-wide, annoncé) | skipped |
| Uninstall | retire la référence | retire la référence + `<PackageVersion>` orphelin | skipped |

### Garde-fous

- Install refusé si verdict `Incompatible` pour la version demandée (`skipped` avec la
  raison) ; `Unknown` autorisé (MSBuild tranchera au restore).
- Élément attendu introuvable (fichier modifié entre-temps, format non géré) → erreur
  propre, fichier intact, l'UI propose « Recharger la vue ».
- Action globale : les écritures réussies sont conservées même si certains projets sont
  skipped ; le DTO détaille les deux listes.

## UI

Aucun nouveau composant — activation des boutons existants :

- Carte projet : `＋` Install(projet), `⇧` Upgrade(projet, version sélectionnée), `🗑`
  Uninstall(projet). Sous CPM, `⇧` par projet reste désactivé (tooltip « géré
  centralement — utilisez la mise à jour globale »).
- Toolbar : `＋` installe sur tous les projets compatibles non équipés, `⇧` met à jour
  partout, `🗑` désinstalle partout. Confirmation native Host
  (`vscode.window.showWarningMessage`, « affectera N projets ») avant toute action
  globale ; pas de confirmation par projet.
- Pendant l'opération : bouton → spinner, autres boutons de la carte désactivés ; à la
  réponse, rechargement de la liste + du package touché.
- Bandeau restore sous la toolbar : « Restore en cours… » → ✔ (disparaît après 4 s) ou
  ✖ persistant avec erreurs dépliables ; les `skipped` s'affichent dans le même bandeau.

## Tests

Conventions Epic 2 : fixtures POSIX, `jest.mock('path' → posix)` pour les suites à fs
mocké, aucun réseau ni process réel.

- `MsBuildTextEditor` : suite principale — fixtures csproj réelles (indentations
  variées, CRLF, BOM, commentaires, ItemGroup conditionnés, attributs multi-lignes,
  self-closing vs contenu), assertions byte-à-byte.
- Handlers : matrice opération × referenceStyle × garde-fous, fs mocké.
- `RestoreScheduler` : débounce, sérialisation, timeout, dotnet absent — `ProcessRunner`
  simulé + fake timers.
- Acceptance : install puis uninstall de bout en bout sur solution fixture, fichiers
  vérifiés à chaque étape.
- UI hors Jest ; vérification manuelle F5 planifiée en fin de plan, avant merge.
