# Recherche et ajout de packages NuGet

**Date** : 2026-07-30 · **Statut** : validé en brainstorming · **Auteur** : Victor DELEAU + Claude

## Contexte

L'extension gère aujourd'hui le cycle de vie complet — installer, mettre à jour,
désinstaller — mais uniquement pour les packages **déjà présents quelque part dans la
solution**. Depuis le correctif d'installation par projet (PR #3), le détail liste tous
les projets et permet d'installer sur ceux qui n'ont pas encore le package ; en revanche
un package absent de toute la solution reste inatteignable. C'est le dernier maillon
manquant du cycle de vie, et il fait la différence entre un inspecteur et un
gestionnaire.

La plomberie existe déjà : `NuGetV3ApiClient` découvre le `SearchQueryService` via le
service index, les verdicts de compatibilité TFM sont calculés pour tous les projets de
la solution, et les trois handlers d'écriture acceptent n'importe quel `packageId` avec
garde de compatibilité. `NuGetConfigResolver` connaît toutes les sources déclarées, dont
les feeds privés, aujourd'hui seulement signalés comme non interrogés.

## Périmètre

**Inclus** : recherche libre paginée sur nuget.org, liste unique scindée en deux sections
dès qu'une recherche est en cours, sélection d'un résultat ouvrant le détail existant,
installation par projet d'un package absent de la solution, i18n fr/en.

**Exclu** : interrogation effective des feeds privés (le contrat et l'architecture les
prévoient, aucune implémentation n'est livrée) ; authentification aux sources ; tri
configurable des résultats (la pertinence renvoyée par la source fait foi) ; installation
globale d'un package absent (voir décision 4) ; recherche par tag, auteur ou dépendance ;
mise en cache des résultats de recherche.

## Décisions de cadrage

1. **Une seule liste, deux sections, aucun mode à choisir.** Le champ existant sert à la
   fois de filtre et de recherche : vide, la liste n'affiche que les packages installés,
   comme aujourd'hui ; dès qu'il contient du texte, la liste se scinde en deux sections
   titrées — « Packages installés » (filtrés localement, instantanés) puis « Résultats de
   la recherche » (nuget.org, débouncés). Aucun geste à apprendre, et l'écart entre ce qui
   est déjà dans la solution et ce qui n'y est pas se lit d'un coup d'œil. Les packages
   déjà installés sont retirés de la seconde section : les répéter n'apprendrait rien.
2. **nuget.org livré, contrat multi-sources dès maintenant** : le port et le DTO sont
   conçus autour d'une liste de sources, chaque résultat portant son origine. Ajouter un
   feed privé plus tard n'impliquera ni changement de contrat ni changement d'UI.
3. **Aucun verdict de compatibilité dans la liste de résultats.** La compatibilité est
   une propriété du couple package + version, pas du package : un badge unique sur une
   ligne de résultat serait un raccourci faux. Pour un package installé, le badge de mise
   à jour a du sens parce qu'il agrège « existe-t-il une version plus récente compatible »
   par rapport à la version en place ; sans version installée, cette question n'a pas de
   référence. Les verdicts restent affichés par version et par projet dans le détail.
   Ce choix évite aussi un appel registration par résultat et par frappe.
4. **Installation par projet uniquement** pour un package absent de la solution. Ajouter
   une dépendance à tous les projets d'un coup est rarement l'intention, et se défait
   difficilement (une désinstallation par projet). La règle ne dépend d'aucun mode : les
   trois boutons globaux du détail n'apparaissent que si le package est déjà installé
   quelque part — sinon il n'y a rien à mettre à jour ni à retirer, et l'ajout se fait
   depuis les cartes projet, une cible à la fois.

## Architecture

```
SearchPackagesQuery ──► SearchPackagesQueryHandler
                              │
                        PackageSearchService        (fusionne, déduplique, ordonne)
                              │
                        IPackageSearchSource[]      (token multi-inject)
                              └── NuGetOrgSearchSource ──► NuGetV3ApiClient
                                  (autres feeds : plus tard, sans toucher au reste)

Web : package-list, deux sections (installés filtrés / résultats distants)
      ──sélection──► packages-view : package de la solution s'il existe,
      sinon SolutionPackageDto synthétique ──► package-detail (inchangé)
```

## Composants

### Port — `Application/Abstractions/Search/IPackageSearchSource.ts`

```ts
export interface PackageSearchHit {
  id: string;
  description: string;
  latestVersion: string;
  totalDownloads?: number;
  verified: boolean;
  iconUrl?: string;
  /** Source d'origine du résultat, affichée et utilisée pour la déduplication. */
  sourceName: string;
}

export interface PackageSearchOptions {
  skip: number;
  take: number;
  includePrerelease: boolean;
}

export interface IPackageSearchSource {
  readonly name: string;
  search(terms: string, options: PackageSearchOptions): Promise<PackageSearchHit[]>;
}
```

Token `PACKAGE_SEARCH_SOURCES` injectant le tableau des sources, même motif que
`PROCESS_RUNNER` et `USER_PROMPT`.

### Implémentation — `Infrastructure/NuGet/NuGetOrgSearchSource.ts` `@singleton()`

`name = "nuget.org"`. Enveloppe `NuGetV3ApiClient`, qui gagne une méthode publique de
recherche libre paginée : `searchPackages(terms, { skip, take, includePrerelease })`,
appelant `${searchQueryUrl}?q=<termes>&skip=&take=&prerelease=&semVerLevel=2.0.0`. Le
service index et la gestion d'erreurs typées (`Offline` / `NotFound` / `RateLimited`)
sont ceux du client existant. Un résultat sans version listée est ignoré.

### Service — `Infrastructure/NuGet/PackageSearchService.ts` `@singleton()`

Interroge toutes les sources **en parallèle**, puis :

- **déduplique** par id insensible à la casse ; en cas de collision, la source la plus
  prioritaire l'emporte (ordre du tableau injecté, qui suit l'ordre de résolution du
  `NuGet.Config`) ;
- **conserve l'ordre de pertinence** renvoyé par la source, les résultats d'une source
  prioritaire précédant ceux d'une source secondaire ;
- **tolère l'échec d'une source** : l'erreur est journalisée, le nom de la source rejoint
  `failedSources`, et les autres résultats sont servis. Tant qu'une source répond, la
  recherche aboutit. Si toutes échouent, la liste est vide et `failedSources` les nomme
  toutes — l'UI distingue ainsi « aucun résultat » de « rien n'a pu être interrogé ».

### Contrat partagé

```ts
SearchPackagesQuery { terms, skip, take, includePrerelease }

SearchResultsDto {
  hits: PackageSearchHitDto[];
  /** Au moins une source a renvoyé une page pleine (`take` résultats) : d'autres
   *  résultats existent en aval. Se juge AVANT déduplication — sinon deux sources
   *  renvoyant les mêmes packages feraient conclure à tort à la fin des résultats. */
  hasMore: boolean;
  /** Sources injoignables lors de cette recherche. */
  failedSources: string[];
}
```

`skip` et `take` sont transmis tels quels à chaque source : la pagination est demandée
par source, jamais recalculée sur le flux fusionné. Avec une seule source livrée, les
deux coïncident ; avec plusieurs, une page peut compter moins de `take` résultats après
déduplication, ce que `hasMore` rend explicite.

`SearchPackagesQueryHandler` dans `Application/Handlers/Packages/`, enregistré DI
(`ProvidePackages`) et WebMediator (`registerRequestType("SearchPackagesQuery", …)`, la
chaîne devant être exactement le nom de la classe).

### Webview

**`package-list`** conserve son champ unique et son filtre d'état de mise à jour (livré en
PR #3), qui continue de porter sur les packages installés. La frappe alimente deux
choses : le filtrage local, instantané, et une recherche distante débouncée à 300 ms,
déclenchée à partir de 2 caractères. Sous ce seuil, les résultats précédents sont
explicitement oubliés — sans quoi ceux d'une recherche abandonnée réapparaîtraient à la
frappe suivante.

Dès que le champ n'est plus vide, deux en-têtes de section apparaissent :

- **Packages installés** — les installés correspondant au texte ; un message dédié si
  aucun ne correspond ;
- **Résultats de la recherche** — les hits distants, moins ceux déjà installés. L'en-tête
  porte la case « inclure les préversions », qui n'a de sens que là. Chaque résultat
  affiche icône, id, description tronquée, téléchargements formatés et badge d'éditeur
  vérifié — **jamais** de badge de compatibilité. Un bouton « Charger plus » apparaît tant
  que `hasMore`, par pages de 25.

**`packages-view`** porte l'état de recherche (termes, page, résultats, chargement en
cours, `hasMore`, sources en échec) et résout la sélection dans un ordre unique : un
package de la solution l'emporte sur un résultat distant de même id — ses installations
réelles sont la vérité. À défaut, il construit un `SolutionPackageDto` synthétique dont
les `installations` sont vides. Le détail fonctionne alors sans modification — toutes les cartes
projet apparaissent en candidat avec leur `＋`, et les verdicts par version arrivent via
`GetPackageUpdateInfoQuery` comme pour un package installé.

**Toolbar du détail** : les trois boutons globaux `＋`, `⇧` et `🗑` sont masqués tant que
le package n'est installé nulle part (décision 4). Un package déjà présent dans la
solution les conserve tous, qu'il ait été atteint par le filtre ou par la recherche.

**Après installation** : `loadPackages()` rafraîchit la solution ; le package rejoint la
section « Packages installés », disparaît des résultats distants, et sa carte projet passe
de candidat à installé avec sa version.

## Gestion d'erreurs

- Source injoignable, quota atteint (429) ou hors ligne : la recherche n'échoue pas ; les
  sources fautives remontent dans `failedSources` et s'affichent dans le bandeau existant
  des feeds non interrogés.
- Aucun résultat : état vide explicite, distinct du cas « toutes les sources ont échoué ».
- Recherche annulée par une frappe plus récente : seule la dernière réponse est retenue
  (compteur de génération, même motif que le polling de restore).
- Le service ne jette jamais : une source qui lève est isolée, jamais propagée.

## Tests

Conventions existantes : fixtures POSIX, aucun réseau ni process réel, `fetch` mocké.

- `PackageSearchService` : fusion de plusieurs sources, déduplication insensible à la
  casse avec priorité à la source la plus prioritaire, source en échec isolée et nommée,
  toutes les sources en échec, ordre des résultats.
- `NuGetOrgSearchSource` : mapping de la réponse V3 vers `PackageSearchHit`, pagination
  (`skip`/`take`), préversions, résultat sans version ignoré, erreurs typées propagées au
  service.
- `SearchPackagesQueryHandler` : mapping vers le DTO et calcul de `hasMore`.
- Acceptance : recherche, sélection d'un résultat, installation sur un projet, puis
  vérification que le package apparaît dans les packages installés de la solution.
- UI hors Jest ; vérification manuelle F5 en fin de plan.
