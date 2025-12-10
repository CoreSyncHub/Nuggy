# Spécifications fonctionnelles – Extension VS Code NuGet Manager

## 1. Objectif

Cette extension VS Code fournit une interface graphique avancée pour la gestion des packages NuGet dans des projets .NET, avec un focus particulier sur :

- La **compatibilité réelle avec la version .NET (TFM - Target Framework Moniker)** des projets
- La **détection intelligente des mises à jour possibles ou bloquées**
- Le support complet du **Central Package Management (CPM)** via `Directory.Packages.props`
- Support des configurations par dossier (`Directory.Build.props` et `Directory.Build.targets`) qui peuvent spécifier des TFM communs à plusieurs projets
- Une **expérience utilisateur fluide** et intégrée dans VS Code
- Une **automatisation maîtrisée**, explicite et réversible

L’objectif n’est pas de cloner Visual Studio ou Rider, mais d’apporter une **gestion NuGet moderne, lisible et orientée décision** dans VS Code, là où les outils actuels sont limités.

---

## 2. Architecture générale

- Extension VS Code avec **Webview** pour l’interface utilisateur
- Interaction avec l’écosystème NuGet via `dotnet` CLI
- Analyse des projets :
  - `.sln` et `.slnx` pour la gestion multi-projets
  - `.csproj` (SDK-style et legacy si possible)
  - `Directory.Packages.props`
  - `Directory.Build.props`
  - `Directory.Build.targets`
  - `packages.config` (support limité)
  - `NuGet.Config`
- Support multi-projets dans une solution

Les projets non SDK-style et packages.config sont supportés de manière fonctionnelle mais ne bénéficient pas de l’ensemble des fonctionnalités avancées (TFM analysis, CPM, upgrade assisté, gestion de build par dossier).

---

## 3. Onglet « Packages »

### 3.1 Vue principale

Deux modes d’affichage :

- **Packages installés** : liste des packages présents dans les projets et en dessous des packages installés, affiche les packages implicitement installés via les dépendances
- **Recherche de packages NuGet** : interface de recherche avec pagination et barre de recherche

Chaque package est affiché avec :

- Nom, icône
- Version installée
- Version(s) disponible(s)
- Dépendances principales
- Indicateurs de compatibilité .NET
- Badges d’état
- Actions rapides (update, uninstall)
- Indication si le package provient d'un auteur vérifié (checkmark bleue si c'est le cas)

---

### 3.2 Actions globales

Boutons disponibles :

- **Restore** : restauration des packages NuGet
- **Refresh** : relecture des dépendances et métadonnées NuGet
- **Upgrade all packages (solution)** :
  - Analyse préalable
  - Application contrôlée des mises à jour
- **Mode de tri** :
  - Alphabetical
  - Smart (priorité aux packages pouvant être mis à jour puis tri alphabétique)

---

### 3.3 Gestion intelligente des mises à jour

Pour chaque package, l’extension détermine :

- Les versions **compatibles avec le TFM effectif** du ou des projets
- Les versions nécessitant une **montée de version .NET**

Options d’affichage :

- Afficher uniquement les versions compatibles
- Option pour afficher également les versions nécessitant un TFM supérieur

---

### 3.4 Badges et statuts

Chaque package peut afficher un badge visuel :

- 🟢 **Upgradable** : mise à jour possible sans changement de TFM
- 🟠 **Upgradable avec upgrade .NET** : version disponible mais TFM insuffisant
- 🔴 **Bloqué** : aucune version compatible disponible
- **Aucun badge** : à jour ou pas de mise à jour disponible et compatible

Ces statuts sont calculés à partir :

- Du TFM du projet
- Des métadonnées NuGet
- Du mode de gestion (CPM ou projet)

Les badges sont calculés par projet ou par solution selon le contexte.

---

### 3.5 Upgrade de version .NET

Fonctionnalité assistée permettant :

- La détection des projets éligibles à une montée de version .NET
- La proposition d’un TFM cible
- L’affichage des impacts (packages débloqués, compatibilités)
- L’application explicite de l’upgrade (jamais automatique sans validation)

---

## 4. Gestion du Central Package Management (CPM)

### 4.1 Détection

L’extension détecte automatiquement :

- La présence d’un fichier `Directory.Packages.props`
- Les projets utilisant le CPM
- Les projets utilisant une gestion locale par `.csproj`

---

### 4.2 Comportement

- Les packages gérés par le CPM sont clairement identifiés
- Les versions sont modifiables :

  - Au niveau central (CPM)
  - Ou au niveau projet si applicable

- Indication visuelle de la **source de vérité** (CPM vs projet)

---

### 4.3 Cohérence multi-projets

- Détection des divergences de versions entre projets
- Mise en évidence des incohérences
- Actions groupées possibles via le CPM

---

## 5. Onglet « Sources » (NuGet.Config)

### Fonctionnalités

- Affichage de la configuration NuGet effective :

  - Machine
  - Utilisateur
  - Solution

- Visualisation hiérarchique des sources
- Édition simplifiée :
  - Activation / désactivation
  - Modification des URLs
  - Ouverture directe dans l’éditeur

---

## 6. Onglet « Dossier » (Caches NuGet)

### Fonctionnalités

- Affichage des emplacements de cache NuGet
- Sélection d’un ou plusieurs dossiers
- Nettoyage manuel des caches

Information affichée :

> Le nettoyage des caches NuGet est sans risque et n’impacte pas les packages installés dans les projets.

---

## 7. Onglet « Log »

### Objectif

Centraliser toutes les opérations liées à NuGet.

### Contenu

- Logs horodatés
- Niveau : info / warning / error
- Type d’opération : restore, install, update, uninstall

### Actions

- Filtrage
- Copie
- Export

---

## 8. Onglet « Settings »

Cet onglet permet de **contrôler finement le comportement de NuGet**, aussi bien pour la recherche que pour l’installation, la mise à jour, la désinstallation et le restore.
Les options proposées influencent directement **la résolution des dépendances**, les performances, et parfois **la reproductibilité des builds**.

### 8.1 Recherche

#### Afficher les versions pré-release (on/off)

- **Effet** : inclut les versions marquées `-alpha`, `-beta`, `-rc`, etc
- **Impact technique** :

  - Permet d’accéder plus tôt aux dernières APIs
  - Augmente le risque d’instabilité

- **Cas d’usage** :
  - Projet de veille technologique
  - Dépendances internes ou preview Microsoft

#### Afficher les versions unlisted (on/off)

- **Effet** : affiche les packages retirés des résultats publics NuGet
- **Impact technique** :

  - Ces versions restent installables si on connaît leur identifiant
  - Souvent retirées pour bugs, failles ou remplacement

- **Cas d’usage** :

  - Maintenance de projets legacy
  - Reproductibilité stricte d’un environnement ancien

#### Taille de page des résultats (`SearchPageSize`)

- **Effet** : nombre de packages retournés par requête
- **Impact technique** :

  - Plus élevé → plus de données réseau et de parsing
  - Plus faible → navigation plus fréquente

- **Compromis** :

  - Performance UI vs confort de navigation

---

### 8.2 Installation / Mise à jour

#### Dependency behavior :

Définit **comment NuGet résout les dépendances transitives** lors de l’installation ou de la mise à jour.

**Ignore**

- Ignore totalement les dépendances
- Risque très élevé de projet cassé
- Réservé à des scénarios très spécifiques

**Lowest**

- Choisit la version minimale compatible
- Comportement le plus stable
- Réduction des breaking changes
- Versions parfois anciennes

**Highest**

- Prend la version la plus récente disponible
- Dernières fonctionnalités
- Risque élevé de breaking changes

**Highest minor (défaut)**

- Dernière version mineure compatible
- Bon compromis entre stabilité et modernité

**Highest patch**

- Dernier correctif uniquement
- Sécurité maximale
- Très faible risque fonctionnel

---

### 8.3 Désinstallation

#### Remove dependencies (booléen, défaut false)

- **Effet** : supprime aussi les dépendances installées uniquement pour ce package
- **Impact technique** :

  - Peut nettoyer efficacement le projet
  - Peut supprimer des packages encore utilisés ailleurs

- **Cas d’usage** :
  - Nettoyage de projets
  - Réduction de la taille des builds

#### Force uninstall (booléen, défaut false)

- **Effet** : force la désinstallation même si le package est référencé ailleurs
- **Impact technique** :
  - Peut casser des projets dépendants
  - Utile pour résoudre des conflits bloquants
- **Cas d’usage** :
  - Nettoyage forcé de packages obsolètes

---

### 8.4 Restore

#### Allow restore missing packages :

Détermine si NuGet est autorisé à restaurer automatiquement les packages manquants après une opération avec NuGet.

- Always and use values from NuGet.Config (défaut)
  → Respect strict de la configuration existante
- Always enable
  → Force le restore même si la config le désactive
- Always disable
  → Aucun restore automatique (build cassera si packages manquants)

#### Restore engine :

**Automatic (défaut)**

- Laisse NuGet choisir le moteur optimal
- Généralement le mode `Dotnet CLI`

**Dotnet CLI**

- Utilise `dotnet restore`
- Optimisé pour les projets SDK-style .NET Core / .NET 5+

**MSBuild**

- Utilise `msbuild /t:Restore`
- Utile pour les projets legacy non SDK-style

**Console**

- Utilise `nuget.exe restore`
- Nécessite une installation préalable de `nuget.exe`
- Utile pour les environnements très legacy

Possibilité de donner des argument personnalisés pour l’exécution du shell qui effectuera la commande, pour permettre la compatibilité avec des environnements spécifiques (WSL, conteneurs, etc).

---

### 8.5 Gestion des packages

Format par défaut

#### PackageReference (défaut)

- Format moderne
- Intégré au `.csproj` ou `Directory.Packages.props` si CPM
- Meilleure performance
- Support natif par `dotnet` CLI

#### packages.config

- Format legacy
- Fichier XML séparé
- Moins performant
- A reserver pour les projets legacy non SDK-style

---

### 8.6 Langue

Sélection de la langue de l’interface :

- Impacte uniquement l'UI de l’extension
- Permet une adoption plus large de l’extension
- Valeurs disponibles :
  - English (défaut)
  - French
  - Spanish
  - Deutsch

---

## 9. Principes directeurs

- Toujours **expliquer avant d’agir**
- Aucune modification silencieuse
- Priorité à la lisibilité et à la compatibilité réelle
- Support des projets modernes .NET en priorité

---

## 10. Positionnement

Cette extension vise à devenir :

> Le gestionnaire NuGet de référence pour les développeurs .NET sur VS Code, orienté compatibilité, cohérence et décisions éclairées.
