# Epic 5 — Écritures de packages : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activer install/upgrade/uninstall (par projet et globaux) par chirurgie textuelle des fichiers MSBuild, avec `dotnet restore` automatique débouncé dont le statut remonte dans l'UI.

**Architecture:** Trois commands CQRS fines (pattern `SelectSolutionCommand`) → handlers qui relisent le fichier cible, appliquent `MsBuildTextEditor` (service pur string→string), écrivent atomiquement, invalident les caches et programment `RestoreScheduler` (débounce 300 ms, spawn `dotnet restore` isolé derrière `ProcessRunner`). L'UI dégrise les boutons existants et affiche un bandeau restore alimenté par `GetRestoreStatusQuery` en polling. Spec : `docs/superpowers/specs/2026-07-25-epic5-ecritures-design.md`.

**Tech Stack:** TypeScript strict, tsyringe, Jest (fixtures POSIX), `child_process.spawn`, Lit. Aucune dépendance npm nouvelle.

## Global Constraints

- Exécution sur une branche dédiée `epic5-package-writes` créée depuis `main` au démarrage
- Messages de commit en français `type: Sujet` + footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Fixtures de tests en chemins POSIX ; toute suite qui mocke `fs` ajoute `jest.mock("path", () => jest.requireActual("path").posix);` juste après `jest.mock("fs");` ; aucun test ne lance de vrai processus ni ne touche le réseau
- Style Prettier du projet : guillemets doubles
- `MsBuildTextEditor` : jamais d'exception sur contenu inattendu — retour `{ ok: false, reason }` ; jamais d'écriture partielle ; formatage/CRLF/BOM préservés byte-à-byte hors de la zone éditée
- Legacy (`PackagesConfig`) : toute écriture refusée → entrée `skipped` avec raison `"legacy project"`
- CPM : upgrade solution-wide via `<PackageVersion>` ; install ajoute `<PackageReference>` SANS attribut Version + crée le `<PackageVersion>` manquant ; uninstall retire la référence et le `<PackageVersion>` devenu orphelin
- Vérification par tâche : jest ciblé pendant l'itération, puis `npm run check-types` avant chaque commit ; suite complète avant les commits des tâches 8, 9 et 11
- Handlers : `@injectable()` + `@HandlerFor(Command)` ; services infra : `@singleton()` ; logger : `@injectToken(LOGGER)`

---

### Task 1 : `MsBuildTextEditor` — localisation et changement de version

**Files:**
- Create: `src/Host/Infrastructure/MsBuild/MsBuildTextEditor.ts`
- Test: `src/Host/Infrastructure/MsBuild/__tests__/MsBuildTextEditor.setVersion.test.ts`

**Interfaces:**
- Consumes: rien (service pur, zéro I/O)
- Produces (consommé par Tasks 2, 6, 7, 8) :
  - `type EditResult = { ok: true; content: string } | { ok: false; reason: string }`
  - `type FoundElement = { start: number; end: number; attributes: Record<string, string> }`
  - `findItemElement(content: string, elementName: "PackageReference" | "PackageVersion", packageId: string): FoundElement | undefined` — id insensible à la casse, attribut `Include` uniquement (les `Update=` sont ignorés), tolère ordre d'attributs, guillemets simples/doubles et éléments multi-lignes
  - `setVersionAttribute(content: string, elementName: "PackageReference" | "PackageVersion", packageId: string, newVersion: string): EditResult` — remplace uniquement la valeur de l'attribut `Version` ; élément introuvable ou sans attribut `Version` → `{ ok: false }`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// src/Host/Infrastructure/MsBuild/__tests__/MsBuildTextEditor.setVersion.test.ts
import { MsBuildTextEditor } from "../MsBuildTextEditor";

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="12.0.1" />
    <PackageReference Include="Serilog" Version="3.1.0" />
  </ItemGroup>
</Project>
`;

describe("MsBuildTextEditor - findItemElement / setVersionAttribute", () => {
  const editor = new MsBuildTextEditor();

  it("localise un élément avec ses attributs", () => {
    const found = editor.findItemElement(CSPROJ, "PackageReference", "Serilog");
    expect(found).toBeDefined();
    expect(found!.attributes).toEqual({ Include: "Serilog", Version: "3.1.0" });
    expect(CSPROJ.slice(found!.start, found!.end)).toContain('Include="Serilog"');
  });

  it("localise insensiblement à la casse mais ignore les Update=", () => {
    expect(editor.findItemElement(CSPROJ, "PackageReference", "newtonsoft.json")).toBeDefined();
    const withUpdate = CSPROJ.replace('Include="Serilog"', 'Update="Serilog"');
    expect(editor.findItemElement(withUpdate, "PackageReference", "Serilog")).toBeUndefined();
  });

  it("remplace uniquement la valeur de Version, reste byte-identique", () => {
    const result = editor.setVersionAttribute(CSPROJ, "PackageReference", "Newtonsoft.Json", "13.0.4");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe(CSPROJ.replace('Version="12.0.1"', 'Version="13.0.4"'));
    }
  });

  it("préserve CRLF, BOM et guillemets simples", () => {
    const crlf = "﻿" + CSPROJ.replace(/\n/g, "\r\n").replace('Version="3.1.0"', "Version='3.1.0'");
    const result = editor.setVersionAttribute(crlf, "PackageReference", "Serilog", "4.0.0");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content.startsWith("﻿")).toBe(true);
      expect(result.content).toContain("Version='4.0.0'");
      expect(result.content).toContain("\r\n");
      expect(result.content.replace("Version='4.0.0'", "Version='3.1.0'")).toBe(crlf);
    }
  });

  it("gère un élément multi-lignes", () => {
    const multi = CSPROJ.replace(
      '<PackageReference Include="Serilog" Version="3.1.0" />',
      '<PackageReference Include="Serilog"\n                      Version="3.1.0" />'
    );
    const result = editor.setVersionAttribute(multi, "PackageReference", "Serilog", "4.0.0");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Version="4.0.0"');
    }
  });

  it("échoue proprement : élément introuvable, Version absente, wildcard accepté tel quel", () => {
    expect(editor.setVersionAttribute(CSPROJ, "PackageReference", "Inconnu", "1.0.0").ok).toBe(false);
    const noVersion = CSPROJ.replace(' Version="3.1.0"', "");
    expect(editor.setVersionAttribute(noVersion, "PackageReference", "Serilog", "4.0.0").ok).toBe(false);
  });

  it("fonctionne pour PackageVersion (fichier CPM)", () => {
    const cpm = `<Project>\n  <ItemGroup>\n    <PackageVersion Include="Serilog" Version="3.1.0" />\n  </ItemGroup>\n</Project>\n`;
    const result = editor.setVersionAttribute(cpm, "PackageVersion", "Serilog", "4.0.0");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('<PackageVersion Include="Serilog" Version="4.0.0" />');
    }
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npx jest src/Host/Infrastructure/MsBuild/__tests__/MsBuildTextEditor.setVersion.test.ts --coverage=false`
Expected: FAIL — `Cannot find module '../MsBuildTextEditor'`

- [ ] **Step 3 : Implémenter**

```ts
// src/Host/Infrastructure/MsBuild/MsBuildTextEditor.ts
import { singleton } from "tsyringe";

export type EditResult = { ok: true; content: string } | { ok: false; reason: string };
export type FoundElement = { start: number; end: number; attributes: Record<string, string> };
export type ItemElementName = "PackageReference" | "PackageVersion";

/**
 * Chirurgie textuelle des fichiers MSBuild : modifications ciblées qui
 * préservent byte-à-byte tout ce qui n'est pas la zone éditée (indentation,
 * commentaires, CRLF, BOM). Service pur : aucune I/O, string → string.
 */
@singleton()
export class MsBuildTextEditor {
  /**
   * Localise l'élément <elementName ... Include="packageId" ... /> (id insensible
   * à la casse). Les éléments Update= sont ignorés (hors périmètre v1).
   */
  public findItemElement(
    content: string,
    elementName: ItemElementName,
    packageId: string
  ): FoundElement | undefined {
    const elementPattern = new RegExp(`<${elementName}\\b[^>]*?(?:/>|>)`, "gs");
    for (const match of content.matchAll(elementPattern)) {
      const attributes = this.parseAttributes(match[0]);
      if (attributes["Include"]?.toLowerCase() === packageId.toLowerCase()) {
        return { start: match.index, end: match.index + match[0].length, attributes };
      }
    }
    return undefined;
  }

  /** Remplace uniquement la valeur de l'attribut Version de l'élément visé. */
  public setVersionAttribute(
    content: string,
    elementName: ItemElementName,
    packageId: string,
    newVersion: string
  ): EditResult {
    const found = this.findItemElement(content, elementName, packageId);
    if (!found) {
      return { ok: false, reason: `élément ${elementName} '${packageId}' introuvable` };
    }
    const elementText = content.slice(found.start, found.end);
    const versionAttr = /(\bVersion\s*=\s*)(["'])(.*?)\2/s.exec(elementText);
    if (!versionAttr) {
      return { ok: false, reason: `l'élément '${packageId}' n'a pas d'attribut Version` };
    }
    const attrStart = found.start + versionAttr.index;
    const before = content.slice(0, attrStart);
    const after = content.slice(attrStart + versionAttr[0].length);
    const quote = versionAttr[2];
    return { ok: true, content: `${before}${versionAttr[1]}${quote}${newVersion}${quote}${after}` };
  }

  private parseAttributes(elementText: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const attr of elementText.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*(["'])(.*?)\2/gs) ) {
      attributes[attr[1]] = attr[3];
    }
    return attributes;
  }
}
```

- [ ] **Step 4 : Vérifier le passage**

Run: `npx jest src/Host/Infrastructure/MsBuild/__tests__/MsBuildTextEditor.setVersion.test.ts --coverage=false`
Expected: PASS (7 tests)

- [ ] **Step 5 : Commit**

```bash
npm run check-types && git add src/Host/Infrastructure/MsBuild
git commit -m "feat: MsBuildTextEditor - localisation et changement de version chirurgical - #Epic5

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 : `MsBuildTextEditor` — insertion et suppression d'éléments

**Files:**
- Modify: `src/Host/Infrastructure/MsBuild/MsBuildTextEditor.ts`
- Test: `src/Host/Infrastructure/MsBuild/__tests__/MsBuildTextEditor.addRemove.test.ts`

**Interfaces:**
- Consumes: Task 1 (`findItemElement`, types)
- Produces (consommé par Tasks 6, 7, 8) :
  - `addItemElement(content: string, elementName: ItemElementName, attributes: Record<string, string>): EditResult` — insère `<Elem A="a" B="b" />` : dans l'ItemGroup contenant déjà des éléments du même type (trié alphabétiquement par Include si l'existant est trié, sinon après le dernier), sinon crée un `<ItemGroup>` neuf avant `</Project>` ; jamais dans un ItemGroup porteur d'une `Condition` ; indentation copiée d'un voisin, fins de ligne du fichier respectées ; élément déjà présent (même Include) → `{ ok: false }`
  - `removeItemElement(content: string, elementName: ItemElementName, packageId: string): EditResult` — supprime l'élément et sa ligne ; un `<ItemGroup>` devenu vide est supprimé aussi

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// src/Host/Infrastructure/MsBuild/__tests__/MsBuildTextEditor.addRemove.test.ts
import { MsBuildTextEditor } from "../MsBuildTextEditor";

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Alpha" Version="1.0.0" />
    <PackageReference Include="Zulu" Version="2.0.0" />
  </ItemGroup>
</Project>
`;

describe("MsBuildTextEditor - addItemElement", () => {
  const editor = new MsBuildTextEditor();

  it("insère trié alphabétiquement dans l'ItemGroup existant, indentation copiée", () => {
    const result = editor.addItemElement(CSPROJ, "PackageReference", {
      Include: "Middle",
      Version: "5.0.0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.content.split("\n");
      const idx = lines.findIndex((l) => l.includes('Include="Middle"'));
      expect(lines[idx]).toBe('    <PackageReference Include="Middle" Version="5.0.0" />');
      expect(lines[idx - 1]).toContain('Include="Alpha"');
      expect(lines[idx + 1]).toContain('Include="Zulu"');
    }
  });

  it("insère après le dernier si l'existant n'est pas trié", () => {
    const unsorted = CSPROJ.replace('Include="Alpha"', 'Include="Zzz"');
    const result = editor.addItemElement(unsorted, "PackageReference", { Include: "Beta", Version: "1.0.0" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.content.split("\n");
      const idx = lines.findIndex((l) => l.includes('Include="Beta"'));
      expect(lines[idx - 1]).toContain('Include="Zulu"');
    }
  });

  it("crée un ItemGroup neuf s'il n'existe aucun élément du type, avant </Project>", () => {
    const noRefs = `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n`;
    const result = editor.addItemElement(noRefs, "PackageReference", { Include: "X", Version: "1.0.0" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain(
        `  <ItemGroup>\n    <PackageReference Include="X" Version="1.0.0" />\n  </ItemGroup>\n</Project>`
      );
    }
  });

  it("n'insère jamais dans un ItemGroup conditionné", () => {
    const conditioned = `<Project>\n  <ItemGroup Condition="'$(TargetFramework)' == 'net8.0'">\n    <PackageReference Include="Alpha" Version="1.0.0" />\n  </ItemGroup>\n</Project>\n`;
    const result = editor.addItemElement(conditioned, "PackageReference", { Include: "Beta", Version: "1.0.0" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Un nouvel ItemGroup non conditionné a été créé
      const groups = result.content.match(/<ItemGroup/g);
      expect(groups).toHaveLength(2);
      expect(result.content.indexOf('Include="Beta"')).toBeGreaterThan(result.content.indexOf("</ItemGroup>"));
    }
  });

  it("insère sans attribut Version (style CPM) et respecte CRLF", () => {
    const crlf = CSPROJ.replace(/\n/g, "\r\n");
    const result = editor.addItemElement(crlf, "PackageReference", { Include: "Middle" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('<PackageReference Include="Middle" />\r\n');
    }
  });

  it("refuse un doublon (même Include, casse ignorée)", () => {
    expect(editor.addItemElement(CSPROJ, "PackageReference", { Include: "alpha", Version: "9" }).ok).toBe(false);
  });
});

describe("MsBuildTextEditor - removeItemElement", () => {
  const editor = new MsBuildTextEditor();

  it("supprime la ligne de l'élément", () => {
    const result = editor.removeItemElement(CSPROJ, "PackageReference", "Alpha");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).not.toContain("Alpha");
      expect(result.content).toContain('Include="Zulu"');
      expect(result.content).toContain("<ItemGroup>");
    }
  });

  it("supprime l'ItemGroup devenu vide", () => {
    const single = CSPROJ.replace(`    <PackageReference Include="Zulu" Version="2.0.0" />\n`, "");
    const result = editor.removeItemElement(single, "PackageReference", "Alpha");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).not.toContain("<ItemGroup>");
      expect(result.content).toContain("<PropertyGroup>");
    }
  });

  it("échoue proprement si l'élément est introuvable", () => {
    expect(editor.removeItemElement(CSPROJ, "PackageReference", "Inconnu").ok).toBe(false);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npx jest src/Host/Infrastructure/MsBuild/__tests__/MsBuildTextEditor.addRemove.test.ts --coverage=false`
Expected: FAIL — `addItemElement is not a function`

- [ ] **Step 3 : Implémenter** (ajouter à la classe existante)

```ts
  /** Insère un élément ; refuse les doublons ; jamais dans un ItemGroup conditionné. */
  public addItemElement(
    content: string,
    elementName: ItemElementName,
    attributes: Record<string, string>
  ): EditResult {
    const include = attributes["Include"];
    if (!include) {
      return { ok: false, reason: "attribut Include requis" };
    }
    if (this.findItemElement(content, elementName, include)) {
      return { ok: false, reason: `'${include}' est déjà présent` };
    }
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const attrText = Object.entries(attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");

    // Groupes non conditionnés contenant déjà des éléments du même type
    const groupPattern = /<ItemGroup(\s[^>]*)?>([\s\S]*?)<\/ItemGroup>/g;
    for (const group of content.matchAll(groupPattern)) {
      if (group[1] && /\bCondition\s*=/.test(group[1])) {
        continue;
      }
      const body = group[2];
      const siblingPattern = new RegExp(`([ \\t]*)<${elementName}\\b[^>]*?(?:/>|>)`, "g");
      const siblings = [...body.matchAll(siblingPattern)];
      if (siblings.length === 0) {
        continue;
      }
      const indent = siblings[0][1];
      const newLine = `${indent}<${elementName} ${attrText} />`;
      const includes = siblings.map((s) => this.parseAttributes(s[0])["Include"] ?? "");
      const isSorted = includes.every(
        (id, i) => i === 0 || includes[i - 1].toLowerCase() <= id.toLowerCase()
      );
      let insertAt: number; // offset dans body
      if (isSorted) {
        const nextSibling = siblings.find(
          (s) => (this.parseAttributes(s[0])["Include"] ?? "").toLowerCase() > include.toLowerCase()
        );
        insertAt = nextSibling
          ? nextSibling.index
          : siblings[siblings.length - 1].index + siblings[siblings.length - 1][0].length + eol.length;
      } else {
        insertAt = siblings[siblings.length - 1].index + siblings[siblings.length - 1][0].length + eol.length;
      }
      const bodyStart = group.index + group[0].indexOf(body);
      const absolute = bodyStart + insertAt;
      const inserted = nextIsLineStart(content, absolute)
        ? `${newLine}${eol}`
        : `${eol}${newLine}`;
      return { ok: true, content: content.slice(0, absolute) + inserted + content.slice(absolute) };
    }

    // Aucun groupe adapté : créer un ItemGroup avant </Project>
    const closing = content.lastIndexOf("</Project>");
    if (closing === -1) {
      return { ok: false, reason: "balise </Project> introuvable" };
    }
    const block = `  <ItemGroup>${eol}    <${elementName} ${attrText} />${eol}  </ItemGroup>${eol}`;
    return { ok: true, content: content.slice(0, closing) + block + content.slice(closing) };

    function nextIsLineStart(text: string, offset: number): boolean {
      const before = text.slice(Math.max(0, offset - 2), offset);
      return before.endsWith("\n");
    }
  }

  /** Supprime l'élément et sa ligne ; purge l'ItemGroup devenu vide. */
  public removeItemElement(
    content: string,
    elementName: ItemElementName,
    packageId: string
  ): EditResult {
    const found = this.findItemElement(content, elementName, packageId);
    if (!found) {
      return { ok: false, reason: `élément ${elementName} '${packageId}' introuvable` };
    }
    // Étendre aux bornes de ligne (y compris l'indentation et le saut final)
    let lineStart = content.lastIndexOf("\n", found.start - 1) + 1;
    let lineEnd = content.indexOf("\n", found.end);
    lineEnd = lineEnd === -1 ? content.length : lineEnd + 1;
    let result = content.slice(0, lineStart) + content.slice(lineEnd);

    // Purger un ItemGroup vide (contenu uniquement blanc)
    result = result.replace(
      /[ \t]*<ItemGroup(\s[^>]*)?>[\s]*<\/ItemGroup>[ \t]*\r?\n?/,
      ""
    );
    return { ok: true, content: result };
  }
```

- [ ] **Step 4 : Vérifier le passage**

Run: `npx jest src/Host/Infrastructure/MsBuild --coverage=false`
Expected: PASS (les deux suites, 16 tests)

- [ ] **Step 5 : Commit**

```bash
npm run check-types && git add src/Host/Infrastructure/MsBuild
git commit -m "feat: MsBuildTextEditor - insertion triée et suppression d'éléments - #Epic5

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 : Contrats — commands, DTOs et query de statut restore

**Files:**
- Create: `src/Shared/Features/Commands/InstallPackageCommand.ts`
- Create: `src/Shared/Features/Commands/UpgradePackageCommand.ts`
- Create: `src/Shared/Features/Commands/UninstallPackageCommand.ts`
- Create: `src/Shared/Features/Dtos/PackageWriteResultDto.ts`
- Create: `src/Shared/Features/Dtos/RestoreStatusDto.ts`
- Create: `src/Shared/Features/Queries/GetRestoreStatusQuery.ts`

**Interfaces:**
- Consumes: `ICommand<T>` (`src/Shared/Abstractions/Messaging/ICommand.ts`), `IQuery<T>`
- Produces: les types ci-dessous, consommés tels quels par les Tasks 5-11

- [ ] **Step 1 : Créer les fichiers**

```ts
// src/Shared/Features/Dtos/PackageWriteResultDto.ts
export interface SkippedProjectDto {
  projectPath: string;
  reason: string;
}

export interface PackageWriteResultDto {
  status: "Ok" | "Error";
  filesChanged: string[];
  affectedProjects: string[];
  skipped: SkippedProjectDto[];
  error?: string;
}
```

```ts
// src/Shared/Features/Dtos/RestoreStatusDto.ts
export type RestoreState = "Idle" | "Running" | "Succeeded" | "Failed";

export interface RestoreStatusDto {
  status: RestoreState;
  messages: string[];
  runId: number;
  finishedAtUtc?: string;
}
```

```ts
// src/Shared/Features/Commands/InstallPackageCommand.ts
import { type ICommand } from "../../Abstractions/Messaging/ICommand";
import { type PackageWriteResultDto } from "../Dtos/PackageWriteResultDto";

/**
 * Installe un package sur un projet, ou sur tous les projets compatibles
 * non équipés si projectPath est absent.
 */
export class InstallPackageCommand implements ICommand<PackageWriteResultDto> {
  constructor(
    public readonly packageId: string,
    public readonly version: string,
    public readonly solutionPath: string,
    public readonly projectPath?: string
  ) {}
}
```

```ts
// src/Shared/Features/Commands/UpgradePackageCommand.ts
import { type ICommand } from "../../Abstractions/Messaging/ICommand";
import { type PackageWriteResultDto } from "../Dtos/PackageWriteResultDto";

/**
 * Met à jour la version d'un package sur un projet, ou partout où il est
 * installé si projectPath est absent. Sous CPM : écriture unique
 * solution-wide dans Directory.Packages.props.
 */
export class UpgradePackageCommand implements ICommand<PackageWriteResultDto> {
  constructor(
    public readonly packageId: string,
    public readonly version: string,
    public readonly solutionPath: string,
    public readonly projectPath?: string
  ) {}
}
```

```ts
// src/Shared/Features/Commands/UninstallPackageCommand.ts
import { type ICommand } from "../../Abstractions/Messaging/ICommand";
import { type PackageWriteResultDto } from "../Dtos/PackageWriteResultDto";

/**
 * Désinstalle un package d'un projet, ou de tous les projets si
 * projectPath est absent. Sous CPM, le PackageVersion devenu orphelin est
 * retiré du Directory.Packages.props.
 */
export class UninstallPackageCommand implements ICommand<PackageWriteResultDto> {
  constructor(
    public readonly packageId: string,
    public readonly solutionPath: string,
    public readonly projectPath?: string
  ) {}
}
```

```ts
// src/Shared/Features/Queries/GetRestoreStatusQuery.ts
import { type IQuery } from "../../Abstractions/Messaging/IQuery";
import { type RestoreStatusDto } from "../Dtos/RestoreStatusDto";

/**
 * Query du statut du dernier dotnet restore programmé par le Host.
 */
export class GetRestoreStatusQuery implements IQuery<RestoreStatusDto> {}
```

- [ ] **Step 2 : Vérifier la compilation et committer**

Run: `npm run check-types`
Expected: exit 0

```bash
git add src/Shared/Features
git commit -m "feat: Contrats des écritures de packages et du statut restore - #Epic5

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4 : `ProcessRunner` + `RestoreScheduler`

**Files:**
- Create: `src/Host/Infrastructure/MsBuild/ProcessRunner.ts`
- Create: `src/Host/Infrastructure/MsBuild/RestoreScheduler.ts`
- Test: `src/Host/Infrastructure/MsBuild/__tests__/RestoreScheduler.test.ts`

**Interfaces:**
- Consumes: `ILogger`/`LOGGER` + `injectToken`, `RestoreStatusDto`/`RestoreState` (Task 3)
- Produces (consommé par Tasks 5-9) :
  - `PROCESS_RUNNER` token + `interface IProcessRunner { run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> }`
  - `ChildProcessRunner` : implémentation réelle (spawn), non testée unitairement (I/O pur)
  - `RestoreScheduler` `@singleton()` : `schedule(solutionPath: string): void` (débounce 300 ms, jamais deux runs concurrents, run suivant enchaîné si demandé pendant l'exécution) ; `getStatus(): RestoreStatusDto` (`Running` dès schedule ; état terminal conservé jusqu'au prochain schedule ; `runId` croissant) ; messages en échec = lignes `error NU\d+`/`error MSB\d+` + code de sortie ; timeout 5 min → `Failed("restore interrompu (timeout)")` ; commande introuvable (exitCode null sans timeout) → `Failed("SDK .NET introuvable (dotnet absent du PATH)")`

- [ ] **Step 1 : Écrire les tests qui échouent**

```ts
// src/Host/Infrastructure/MsBuild/__tests__/RestoreScheduler.test.ts
import { RestoreScheduler } from "../RestoreScheduler";
import { type IProcessRunner } from "../ProcessRunner";
import { type ILogger } from "@/Host/Application/Abstractions/Log/ILogger";

const noOpLogger: ILogger = { Info: jest.fn(), Warning: jest.fn(), Error: jest.fn(), Debug: jest.fn() };

function runnerReturning(result: { exitCode: number | null; output: string; timedOut: boolean }) {
  return { run: jest.fn().mockResolvedValue(result) } as IProcessRunner;
}

describe("RestoreScheduler", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("débounce : trois schedule rapprochés → un seul run", async () => {
    const runner = runnerReturning({ exitCode: 0, output: "", timedOut: false });
    const scheduler = new RestoreScheduler(runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    scheduler.schedule("/Solution/My.sln");
    scheduler.schedule("/Solution/My.sln");
    expect(scheduler.getStatus().status).toBe("Running");
    await jest.advanceTimersByTimeAsync(300);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith("dotnet", ["restore", "/Solution/My.sln"], "/Solution", 300_000);
    expect(scheduler.getStatus().status).toBe("Succeeded");
  });

  it("un schedule pendant un run en cours enchaîne un second run à la fin", async () => {
    let release!: (v: { exitCode: number; output: string; timedOut: boolean }) => void;
    const runner: IProcessRunner = {
      run: jest
        .fn()
        .mockImplementationOnce(() => new Promise((r) => { release = r; }))
        .mockResolvedValueOnce({ exitCode: 0, output: "", timedOut: false }),
    };
    const scheduler = new RestoreScheduler(runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300); // run 1 démarre et reste pendu
    scheduler.schedule("/Solution/My.sln");   // pendant le run
    await jest.advanceTimersByTimeAsync(300);
    expect(runner.run).toHaveBeenCalledTimes(1); // pas de concurrence
    release({ exitCode: 0, output: "", timedOut: false });
    await jest.advanceTimersByTimeAsync(300);
    expect(runner.run).toHaveBeenCalledTimes(2); // enchaîné après la fin
    expect(scheduler.getStatus().status).toBe("Succeeded");
  });

  it("échec : extrait les lignes error NU/MSB, runId croît", async () => {
    const output = [
      "  Determining projects to restore...",
      "/x/A.csproj : error NU1102: Unable to find package Foo with version 9.9.9",
      "some noise",
      "/x/B.csproj : error MSB4025: The project file could not be loaded.",
    ].join("\n");
    const runner = runnerReturning({ exitCode: 1, output, timedOut: false });
    const scheduler = new RestoreScheduler(runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300);
    const status = scheduler.getStatus();
    expect(status.status).toBe("Failed");
    expect(status.messages).toEqual([
      "/x/A.csproj : error NU1102: Unable to find package Foo with version 9.9.9",
      "/x/B.csproj : error MSB4025: The project file could not be loaded.",
    ]);
    expect(status.runId).toBe(1);
  });

  it("timeout → Failed avec message dédié", async () => {
    const runner = runnerReturning({ exitCode: null, output: "", timedOut: true });
    const scheduler = new RestoreScheduler(runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300);
    expect(scheduler.getStatus().status).toBe("Failed");
    expect(scheduler.getStatus().messages[0]).toContain("timeout");
  });

  it("dotnet introuvable → Failed avec message SDK", async () => {
    const runner = runnerReturning({ exitCode: null, output: "", timedOut: false });
    const scheduler = new RestoreScheduler(runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300);
    expect(scheduler.getStatus().messages[0]).toContain("SDK .NET introuvable");
  });

  it("l'état terminal reste consultable puis repasse Running au schedule suivant", async () => {
    const runner = runnerReturning({ exitCode: 0, output: "", timedOut: false });
    const scheduler = new RestoreScheduler(runner, noOpLogger);
    scheduler.schedule("/Solution/My.sln");
    await jest.advanceTimersByTimeAsync(300);
    expect(scheduler.getStatus().status).toBe("Succeeded");
    scheduler.schedule("/Solution/My.sln");
    expect(scheduler.getStatus().status).toBe("Running");
    await jest.advanceTimersByTimeAsync(300);
    expect(scheduler.getStatus().runId).toBe(2);
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npx jest src/Host/Infrastructure/MsBuild/__tests__/RestoreScheduler.test.ts --coverage=false`
Expected: FAIL — modules introuvables

- [ ] **Step 3 : Implémenter**

```ts
// src/Host/Infrastructure/MsBuild/ProcessRunner.ts
import { spawn } from "child_process";
import { singleton } from "tsyringe";
import { InjectionToken } from "@Shared/DependencyInjection/InjectionToken";

export interface ProcessResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

export interface IProcessRunner {
  run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult>;
}

export const PROCESS_RUNNER = new InjectionToken<IProcessRunner>("IProcessRunner");

/**
 * Exécution réelle de processus enfants (I/O pur, non testé unitairement).
 * La sortie stdout+stderr est capturée intégralement.
 */
@singleton()
export class ChildProcessRunner implements IProcessRunner {
  public run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
    return new Promise((resolve) => {
      let output = "";
      let timedOut = false;
      const child = spawn(command, args, { cwd, shell: false });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ exitCode: null, output, timedOut: false }); // commande introuvable
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code, output, timedOut });
      });
    });
  }
}
```

**Note d'adaptation** : vérifier l'existence et la forme de `InjectionToken` dans
`src/Shared/DependencyInjection/` (c'est le mécanisme derrière `LOGGER`/`DISPATCHER`) et
suivre exactement le même motif de déclaration de token que `LOGGER`.

```ts
// src/Host/Infrastructure/MsBuild/RestoreScheduler.ts
import * as path from "path";
import { singleton } from "tsyringe";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { type ILogger, LOGGER } from "../../Application/Abstractions/Log/ILogger";
import { type RestoreStatusDto } from "@Shared/Features/Dtos/RestoreStatusDto";
import { PROCESS_RUNNER, type IProcessRunner } from "./ProcessRunner";

const DEBOUNCE_MS = 300;
const RESTORE_TIMEOUT_MS = 300_000;

/**
 * Programme les dotnet restore : débounce 300 ms, jamais deux runs
 * concurrents (le suivant s'enchaîne), statut consultable par query.
 */
@singleton()
export class RestoreScheduler {
  private status: RestoreStatusDto = { status: "Idle", messages: [], runId: 0 };
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private running = false;
  private pendingSolution?: string;

  constructor(
    @injectToken(PROCESS_RUNNER) private readonly processRunner: IProcessRunner,
    @injectToken(LOGGER) private readonly logger: ILogger
  ) {}

  public schedule(solutionPath: string): void {
    this.pendingSolution = solutionPath;
    this.status = { status: "Running", messages: [], runId: this.status.runId };
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => void this.fire(), DEBOUNCE_MS);
  }

  public getStatus(): RestoreStatusDto {
    return this.status;
  }

  private async fire(): Promise<void> {
    if (this.running || !this.pendingSolution) {
      return; // un run en cours relancera via sa fin
    }
    const solutionPath = this.pendingSolution;
    this.pendingSolution = undefined;
    this.running = true;
    const runId = this.status.runId + 1;
    try {
      const result = await this.processRunner.run(
        "dotnet",
        ["restore", solutionPath],
        path.dirname(solutionPath),
        RESTORE_TIMEOUT_MS
      );
      this.logger.Info("dotnet restore terminé", { solutionPath, exitCode: result.exitCode });
      this.logger.Debug(result.output);
      this.status = this.toStatus(result, runId);
    } finally {
      this.running = false;
      if (this.pendingSolution) {
        this.debounceTimer = setTimeout(() => void this.fire(), DEBOUNCE_MS);
      }
    }
  }

  private toStatus(
    result: { exitCode: number | null; output: string; timedOut: boolean },
    runId: number
  ): RestoreStatusDto {
    const finishedAtUtc = new Date().toISOString();
    if (result.timedOut) {
      return { status: "Failed", messages: ["restore interrompu (timeout)"], runId, finishedAtUtc };
    }
    if (result.exitCode === null) {
      return {
        status: "Failed",
        messages: ["SDK .NET introuvable (dotnet absent du PATH)"],
        runId,
        finishedAtUtc,
      };
    }
    if (result.exitCode === 0) {
      return { status: "Succeeded", messages: [], runId, finishedAtUtc };
    }
    const errors = result.output
      .split(/\r?\n/)
      .filter((line) => /error (NU|MSB)\d+/.test(line))
      .map((line) => line.trim());
    return {
      status: "Failed",
      messages: errors.length > 0 ? errors : [`dotnet restore a échoué (code ${result.exitCode})`],
      runId,
      finishedAtUtc,
    };
  }
}
```

- [ ] **Step 4 : Vérifier le passage**

Run: `npx jest src/Host/Infrastructure/MsBuild/__tests__/RestoreScheduler.test.ts --coverage=false`
Expected: PASS (6 tests)

- [ ] **Step 5 : Commit**

```bash
npm run check-types && git add src/Host/Infrastructure/MsBuild
git commit -m "feat: RestoreScheduler - restore débouncé, sérialisé, statut consultable - #Epic5

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5 : `PackageWriteTargetResolver` + port de confirmation `IUserPrompt`

**Files:**
- Create: `src/Host/Infrastructure/MsBuild/PackageWriteTargetResolver.ts`
- Create: `src/Host/Application/Abstractions/Prompt/IUserPrompt.ts`
- Create: `src/Host/Infrastructure/Prompt/VscUserPrompt.ts`
- Test: `src/Host/Infrastructure/MsBuild/__tests__/PackageWriteTargetResolver.test.ts`

**Interfaces:**
- Consumes: `SlnParser`/`SlnxParser` (`parse(path).projects[].path`), `PackagesConfigParser.isLegacyProject`, `PackageReferenceParser.parseMultiple` (→ `Map<string, PackageReference[]>`, `ref.name`/`ref.version`/`ref.hasLocalVersion`), `CpmDiagnosticService.analyze` (→ `{ packageVersions }` avec `pv.name`/`pv.version`), `BuildConfigDetector.findAllConfigFiles`/`buildHierarchy` + `BuildConfigParser.parse` (fichiers CPM = type `DirectoryPackagesProps`, propriété `directory`/`path`)
- Produces (consommé par Tasks 6, 7, 8) :
  - `interface WriteTarget { projectPath: string; style: "PackageReference" | "CpmManaged" | "PackagesConfig"; installedVersion?: string; cpmFilePath?: string }`
  - `resolveTargets(solutionPath: string, packageId: string): Promise<{ targets: WriteTarget[]; cpmFilePath?: string }>` — un `WriteTarget` par projet de la solution ; `installedVersion` absent = package non installé sur ce projet ; `cpmFilePath` global = fichier CPM le plus proche de la solution (pour les créations de PackageVersion)
  - `USER_PROMPT` token + `interface IUserPrompt { confirm(message: string): Promise<boolean> }` ; `VscUserPrompt` = `vscode.window.showWarningMessage(message, { modal: true }, "Continue")` → true si "Continue"

- [ ] **Step 1 : Écrire les tests qui échouent** (fs mocké + path posix, fixtures sln/csproj/CPM sur le modèle de `GetSolutionPackagesQueryHandler.test.ts` — reprendre son bloc `beforeEach` de mocks fs/vscode à l'identique)

```ts
// src/Host/Infrastructure/MsBuild/__tests__/PackageWriteTargetResolver.test.ts
import * as fs from "fs";
jest.mock("fs");
// Force POSIX path semantics so the mocked-fs fixtures behave identically on
// every OS (path.win32.join would rewrite '/' to '\\' and break exact-string
// mocks). Platform-specific production code uses path.win32 explicitly.
jest.mock("path", () => jest.requireActual("path").posix);
jest.mock(
  "vscode",
  () => ({
    workspace: { findFiles: jest.fn().mockResolvedValue([]) },
    Uri: { file: (p: string) => ({ fsPath: p }) },
  }),
  { virtual: true }
);

import { createPackageWriteTargetResolver } from "../../../../Tests/Helpers/createHandlers";

const mockFs = fs as jest.Mocked<typeof fs>;

const SLN = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "Api\\\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "Core\\\\Core.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
`;

const API_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Serilog" Version="3.1.0" />
  </ItemGroup>
</Project>`;

const CORE_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
</Project>`;

describe("PackageWriteTargetResolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const files: Record<string, string> = {
      "/Solution/My.sln": SLN,
      "/Solution/Api/Api.csproj": API_CSPROJ,
      "/Solution/Core/Core.csproj": CORE_CSPROJ,
    };
    mockFs.existsSync.mockImplementation((p) => (p as string) in files);
    mockFs.statSync.mockImplementation(
      (p) => ({ isFile: () => (p as string) in files }) as unknown as fs.Stats
    );
    mockFs.readFileSync.mockImplementation((p) => {
      const content = files[p as string];
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    });
  });

  it("résout un target par projet avec style et version installée", async () => {
    const resolver = createPackageWriteTargetResolver();
    const { targets, cpmFilePath } = await resolver.resolveTargets("/Solution/My.sln", "Serilog");
    expect(cpmFilePath).toBeUndefined();
    expect(targets).toEqual([
      {
        projectPath: "/Solution/Api/Api.csproj",
        style: "PackageReference",
        installedVersion: "3.1.0",
      },
      { projectPath: "/Solution/Core/Core.csproj", style: "PackageReference" },
    ]);
  });
});
```

**Note pour l'implémenteur** : ajouter aussi un second `describe` couvrant le cas CPM
(fixture avec `Directory.Packages.props` détecté via le mock `vscode.workspace.findFiles`
— regarder comment `GetSolutionPackagesQueryHandler.test.ts` mocke `findFiles` pour les
fichiers de build ; le mock doit renvoyer l'URI du fichier CPM) : style `CpmManaged`,
`installedVersion` venant du `<PackageVersion>`, `cpmFilePath` renseigné sur chaque
target CPM et au niveau global. Et un cas legacy : projet avec `packages.config` →
style `PackagesConfig`.

- [ ] **Step 2 : Vérifier l'échec**

Run: `npx jest src/Host/Infrastructure/MsBuild/__tests__/PackageWriteTargetResolver.test.ts --coverage=false`
Expected: FAIL — factory absente

- [ ] **Step 3 : Implémenter**

```ts
// src/Host/Infrastructure/MsBuild/PackageWriteTargetResolver.ts
import * as path from "path";
import { singleton } from "tsyringe";
import { SlnParser } from "@Infrastructure/Solution/SlnParser";
import { SlnxParser } from "@Infrastructure/Solution/SlnxParser";
import { BuildConfigDetector } from "@Infrastructure/Build/BuildConfigDetector";
import { BuildConfigParser } from "@Infrastructure/Build/BuildConfigParser";
import { PackageReferenceParser } from "@Infrastructure/Packages/PackageReferenceParser";
import { PackagesConfigParser } from "@Infrastructure/Packages/PackagesConfigParser";
import { CpmDiagnosticService } from "@Infrastructure/Packages/CpmDiagnosticService";
import { BuildConfigFileType } from "@Domain/Build/Enums/BuildConfigFileType";

export interface WriteTarget {
  projectPath: string;
  style: "PackageReference" | "CpmManaged" | "PackagesConfig";
  installedVersion?: string;
  cpmFilePath?: string;
}

/**
 * Résout, pour un package donné, l'état d'écriture de chaque projet de la
 * solution : style de référence, version installée, fichier CPM applicable.
 */
@singleton()
export class PackageWriteTargetResolver {
  constructor(
    private readonly slnParser: SlnParser,
    private readonly slnxParser: SlnxParser,
    private readonly buildConfigDetector: BuildConfigDetector,
    private readonly buildConfigParser: BuildConfigParser,
    private readonly packageReferenceParser: PackageReferenceParser,
    private readonly packagesConfigParser: PackagesConfigParser,
    private readonly cpmDiagnosticService: CpmDiagnosticService
  ) {}

  public async resolveTargets(
    solutionPath: string,
    packageId: string
  ): Promise<{ targets: WriteTarget[]; cpmFilePath?: string }> {
    const ext = path.extname(solutionPath).toLowerCase();
    const projectPaths =
      ext === ".slnx"
        ? this.slnxParser.parse(solutionPath).projects.map((p) => p.path)
        : this.slnParser.parse(solutionPath).projects.map((p) => p.path);

    const buildConfigFiles = await this.buildConfigDetector.findAllConfigFiles();
    this.buildConfigDetector.buildHierarchy(buildConfigFiles);
    for (const file of buildConfigFiles) {
      this.buildConfigParser.parse(file.path, file);
    }
    const cpmFiles = buildConfigFiles.filter(
      (f) => f.type === BuildConfigFileType.DirectoryPackagesProps
    );
    const solutionCpmFile = cpmFiles.length > 0 ? cpmFiles[0].path : undefined;

    const sdkProjects = projectPaths.filter((p) => !this.packagesConfigParser.isLegacyProject(p));
    const references = this.packageReferenceParser.parseMultiple(sdkProjects);
    const cpmResult = this.cpmDiagnosticService.analyze(buildConfigFiles, references);
    const cpmVersion = cpmResult.packageVersions.find(
      (pv) => pv.name.toLowerCase() === packageId.toLowerCase()
    )?.version;

    const targets: WriteTarget[] = projectPaths.map((projectPath) => {
      if (this.packagesConfigParser.isLegacyProject(projectPath)) {
        return { projectPath, style: "PackagesConfig" };
      }
      const ref = (references.get(projectPath) ?? []).find(
        (r) => r.name.toLowerCase() === packageId.toLowerCase()
      );
      const isCpm = solutionCpmFile !== undefined && (!ref || !ref.hasLocalVersion);
      if (isCpm) {
        return {
          projectPath,
          style: "CpmManaged",
          installedVersion: ref ? (ref.version ?? cpmVersion) : undefined,
          cpmFilePath: solutionCpmFile,
        };
      }
      return {
        projectPath,
        style: "PackageReference",
        installedVersion: ref?.version,
      };
    });

    return { targets, cpmFilePath: solutionCpmFile };
  }
}
```

```ts
// src/Host/Application/Abstractions/Prompt/IUserPrompt.ts
import { InjectionToken } from "@Shared/DependencyInjection/InjectionToken";

export interface IUserPrompt {
  /** Confirmation modale ; résout true si l'utilisateur accepte. */
  confirm(message: string): Promise<boolean>;
}

export const USER_PROMPT = new InjectionToken<IUserPrompt>("IUserPrompt");
```

```ts
// src/Host/Infrastructure/Prompt/VscUserPrompt.ts
import * as vscode from "vscode";
import { singleton } from "tsyringe";
import { type IUserPrompt } from "@Application/Abstractions/Prompt/IUserPrompt";

@singleton()
export class VscUserPrompt implements IUserPrompt {
  public async confirm(message: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Continue");
    return choice === "Continue";
  }
}
```

Ajouter la factory de test dans `src/Tests/Helpers/createHandlers.ts` (réutiliser le
`noOpLogger` et les constructions existantes du fichier) :

```ts
export function createPackageWriteTargetResolver(): PackageWriteTargetResolver {
  return new PackageWriteTargetResolver(
    new SlnParser(),
    new SlnxParser(),
    new BuildConfigDetector(),
    new BuildConfigParser(noOpLogger),
    new PackageReferenceParser(noOpLogger),
    new PackagesConfigParser(noOpLogger),
    new CpmDiagnosticService(new PackageVersionParser())
  );
}
```

**Notes d'adaptation** : vérifier le motif exact de déclaration des tokens
(`InjectionToken`) et la casse des imports dans les fichiers réels avant d'écrire ;
`vscode.window.showWarningMessage` doit être ajouté au mock vscode de `jest.setup.js`
si une suite l'exerce (`window: { showWarningMessage: jest.fn() }`).

- [ ] **Step 4 : Vérifier le passage**

Run: `npx jest src/Host/Infrastructure/MsBuild --coverage=false`
Expected: PASS (toutes les suites MsBuild)

- [ ] **Step 5 : Commit**

```bash
npm run check-types && git add src/Host/Infrastructure/MsBuild src/Host/Application/Abstractions/Prompt src/Host/Infrastructure/Prompt src/Tests/Helpers/createHandlers.ts
git commit -m "feat: Résolution des cibles d'écriture et port de confirmation - #Epic5

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6 : `InstallPackageCommandHandler`

**Files:**
- Create: `src/Host/Application/Handlers/Packages/InstallPackageCommandHandler.ts`
- Test: `src/Host/Application/Handlers/Packages/__tests__/InstallPackageCommandHandler.test.ts`

**Interfaces:**
- Consumes: `PackageWriteTargetResolver.resolveTargets`, `MsBuildTextEditor.addItemElement`/`findItemElement`, `RestoreScheduler.schedule`, `USER_PROMPT`/`IUserPrompt`, `PackageMetadataCache` + `ProjectTfmCache` (invalidation — vérifier leurs méthodes réelles : si aucune méthode d'invalidation n'existe, l'ajouter : `invalidate(key: string)` supprimant l'entrée), `NuGetV3ApiClient.getRegistrationLeaves` + `TfmCompatibilityService.isCompatible` + `ProjectTfmCache`/`TfmResolver` (verdict de garde), `ILogger`
- Produces: handler de `InstallPackageCommand` → `PackageWriteResultDto` ; règles :
  - cible = `projectPath` fourni, sinon tous les projets où le package n'est PAS installé
  - garde : legacy → skipped `"legacy project"` ; déjà installé → skipped `"already installed"` ; verdict `Incompatible` pour la version demandée → skipped avec la raison (verdict calculé via les dependencyGroups de la version demandée ; registration inaccessible → `Unknown` → autorisé)
  - action globale (`projectPath` absent) ET plus d'un projet cible → `IUserPrompt.confirm("Install <id> <version> on N projects?")` ; refus → `{ status: "Ok", filesChanged: [], affectedProjects: [], skipped: [] }` sans écriture
  - écriture par style : `PackageReference` → `addItemElement(csproj, "PackageReference", { Include, Version })` ; `CpmManaged` → `addItemElement(csproj, "PackageReference", { Include })` + si `<PackageVersion>` absent du fichier CPM, `addItemElement(cpmFile, "PackageVersion", { Include, Version })` (une seule fois)
  - lecture du fichier juste avant édition, écriture atomique (`writeFileSync` du contenu complet), `filesChanged` dédupliqué
  - au moins une écriture réussie → invalider `PackageMetadataCache` (clé `${solutionPath}::${id.toLowerCase()}`) et `ProjectTfmCache` (clé solutionPath), puis `RestoreScheduler.schedule(solutionPath)`
  - échec d'édition (`ok: false`) sur la cible explicite → `{ status: "Error", error: reason }` sans autre écriture ; en global, la cible en échec devient un `skipped` et on continue

- [ ] **Step 1 : Écrire les tests qui échouent** — même socle de mocks fs/path/vscode que la Task 5 ; construire le handler à la main avec : resolver réel (via la factory), `MsBuildTextEditor` réel, `RestoreScheduler` factice (`{ schedule: jest.fn() }`), prompt factice (`{ confirm: jest.fn().mockResolvedValue(true) }`), caches factices (`{ invalidate: jest.fn() }`), `NuGetV3ApiClient` factice (`getRegistrationLeaves` renvoyant des dependencyGroups netstandard2.0), `TfmCompatibilityService` réel, TfmResolver réel. Cas à couvrir :

```ts
it("installe sur le projet cible (écriture disque + restore programmé)", ...);
// → writeFileSync appelé avec le csproj contenant la nouvelle PackageReference,
//   restore.schedule('/Solution/My.sln'), résultat Ok avec filesChanged/affectedProjects

it("install global : saute les projets déjà équipés et les legacy, confirme si >1 cible", ...);
// → prompt.confirm appelé ; skipped contient {reason:'already installed'} et {reason:'legacy project'}

it("refus de confirmation → aucune écriture", ...);

it("CPM : ajoute la référence sans Version et crée le PackageVersion manquant une seule fois", ...);
// → deux fichiers dans filesChanged : le csproj et le Directory.Packages.props

it("verdict Incompatible pour la version demandée → skipped avec raison", ...);
// → apiClient mocké : dependencyGroups net9.0 ; projet net8.0 → skipped, aucune écriture

it("registration inaccessible → Unknown → installation autorisée", ...);
```

Écrire ces six tests en entier (fixtures + assertions concrètes) sur le modèle des
suites handlers de l'Epic 2 — les squelettes ci-dessus définissent le comportement
attendu, pas des tests à trous : chaque `it` doit être complet dans le fichier livré.

- [ ] **Step 2 : Vérifier l'échec** — `npx jest src/Host/Application/Handlers/Packages/__tests__/InstallPackageCommandHandler.test.ts --coverage=false` → FAIL module introuvable

- [ ] **Step 3 : Implémenter**

```ts
// src/Host/Application/Handlers/Packages/InstallPackageCommandHandler.ts
import * as fs from "fs";
import { injectable } from "tsyringe";
import { injectToken } from "@Shared/DependencyInjection/inject";
import { type ICommandHandler } from "@Shared/Abstractions/Messaging/ICommandHandler";
import { HandlerFor } from "@Shared/Infrastructure/Messaging/HandlerFor";
import { InstallPackageCommand } from "@Shared/Features/Commands/InstallPackageCommand";
import {
  type PackageWriteResultDto,
  type SkippedProjectDto,
} from "@Shared/Features/Dtos/PackageWriteResultDto";
import { MsBuildTextEditor } from "@Infrastructure/MsBuild/MsBuildTextEditor";
import { PackageWriteTargetResolver, type WriteTarget } from "@Infrastructure/MsBuild/PackageWriteTargetResolver";
import { RestoreScheduler } from "@Infrastructure/MsBuild/RestoreScheduler";
import { PackageMetadataCache } from "@Infrastructure/NuGet/PackageMetadataCache";
import { ProjectTfmCache } from "@Infrastructure/Projects/ProjectTfmCache";
import { NuGetV3ApiClient } from "@Infrastructure/NuGet/NuGetV3ApiClient";
import { TfmCompatibilityService } from "@Infrastructure/Projects/TfmCompatibilityService";
import { USER_PROMPT, type IUserPrompt } from "../../Abstractions/Prompt/IUserPrompt";
import { type ILogger, LOGGER } from "../../Abstractions/Log/ILogger";

@injectable()
@HandlerFor(InstallPackageCommand)
export class InstallPackageCommandHandler
  implements ICommandHandler<InstallPackageCommand, PackageWriteResultDto>
{
  constructor(
    private readonly targetResolver: PackageWriteTargetResolver,
    private readonly editor: MsBuildTextEditor,
    private readonly restoreScheduler: RestoreScheduler,
    private readonly metadataCache: PackageMetadataCache,
    private readonly tfmCache: ProjectTfmCache,
    private readonly apiClient: NuGetV3ApiClient,
    private readonly compatibility: TfmCompatibilityService,
    @injectToken(USER_PROMPT) private readonly prompt: IUserPrompt,
    @injectToken(LOGGER) private readonly logger: ILogger
  ) {}

  async Handle(command: InstallPackageCommand): Promise<PackageWriteResultDto> {
    const { targets, cpmFilePath } = await this.targetResolver.resolveTargets(
      command.solutionPath,
      command.packageId
    );

    const skipped: SkippedProjectDto[] = [];
    const candidates: WriteTarget[] = [];
    const packageFrameworks = await this.frameworksOf(command.packageId, command.version);

    for (const target of this.selectTargets(targets, command.projectPath)) {
      if (target.style === "PackagesConfig") {
        skipped.push({ projectPath: target.projectPath, reason: "legacy project" });
      } else if (target.installedVersion !== undefined) {
        skipped.push({ projectPath: target.projectPath, reason: "already installed" });
      } else {
        const verdict = this.verdictFor(target.projectPath, packageFrameworks);
        if (verdict.verdict === "Incompatible") {
          skipped.push({ projectPath: target.projectPath, reason: verdict.reason ?? "incompatible" });
        } else {
          candidates.push(target);
        }
      }
    }

    if (command.projectPath === undefined && candidates.length > 1) {
      const accepted = await this.prompt.confirm(
        `Install ${command.packageId} ${command.version} on ${candidates.length} projects?`
      );
      if (!accepted) {
        return { status: "Ok", filesChanged: [], affectedProjects: [], skipped: [] };
      }
    }

    const filesChanged = new Set<string>();
    const affectedProjects: string[] = [];
    let cpmVersionEnsured = false;

    for (const target of candidates) {
      const attrs =
        target.style === "CpmManaged"
          ? { Include: command.packageId }
          : { Include: command.packageId, Version: command.version };
      const applied = this.applyEdit(target.projectPath, (content) =>
        this.editor.addItemElement(content, "PackageReference", attrs)
      );
      if (!applied.ok) {
        if (command.projectPath !== undefined) {
          return { status: "Error", filesChanged: [...filesChanged], affectedProjects, skipped, error: applied.reason };
        }
        skipped.push({ projectPath: target.projectPath, reason: applied.reason });
        continue;
      }
      filesChanged.add(target.projectPath);
      affectedProjects.push(target.projectPath);

      if (target.style === "CpmManaged" && cpmFilePath && !cpmVersionEnsured) {
        const cpmContent = fs.readFileSync(cpmFilePath, "utf8");
        if (!this.editor.findItemElement(cpmContent, "PackageVersion", command.packageId)) {
          const cpmEdit = this.editor.addItemElement(cpmContent, "PackageVersion", {
            Include: command.packageId,
            Version: command.version,
          });
          if (cpmEdit.ok) {
            fs.writeFileSync(cpmFilePath, cpmEdit.content);
            filesChanged.add(cpmFilePath);
          }
        }
        cpmVersionEnsured = true;
      }
    }

    if (filesChanged.size > 0) {
      this.metadataCache.invalidate(`${command.solutionPath}::${command.packageId.toLowerCase()}`);
      this.tfmCache.invalidate(command.solutionPath);
      this.restoreScheduler.schedule(command.solutionPath);
    }
    return { status: "Ok", filesChanged: [...filesChanged], affectedProjects, skipped };
  }

  private selectTargets(targets: WriteTarget[], projectPath?: string): WriteTarget[] {
    if (projectPath === undefined) {
      return targets;
    }
    return targets.filter((t) => t.projectPath === projectPath);
  }

  private applyEdit(
    filePath: string,
    edit: (content: string) => { ok: true; content: string } | { ok: false; reason: string }
  ): { ok: true } | { ok: false; reason: string } {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      return { ok: false, reason: `lecture impossible : ${filePath}` };
    }
    const result = edit(content);
    if (!result.ok) {
      return result;
    }
    try {
      fs.writeFileSync(filePath, result.content);
    } catch {
      return { ok: false, reason: `écriture impossible : ${filePath}` };
    }
    return { ok: true };
  }

  private async frameworksOf(packageId: string, version: string): Promise<string[] | undefined> {
    try {
      const leaves = await this.apiClient.getRegistrationLeaves(packageId);
      const leaf = leaves.find((l) => l.version === version);
      return leaf?.dependencyGroups.map((g) => g.targetFramework).filter((t) => t.length > 0);
    } catch (error) {
      this.logger.Warning("Verdict indisponible (registration inaccessible)", { packageId, error });
      return undefined; // → Unknown → autorisé
    }
  }

  private verdictFor(
    projectPath: string,
    packageFrameworks: string[] | undefined
  ): { verdict: "Compatible" | "Incompatible" | "Unknown"; reason?: string } {
    if (packageFrameworks === undefined) {
      return { verdict: "Unknown" };
    }
    const tfms = this.tfmCache.getCachedTfms?.(projectPath) ?? [];
    if (tfms.length === 0) {
      return { verdict: "Unknown" };
    }
    for (const tfm of tfms) {
      const result = this.compatibility.isCompatible(tfm, packageFrameworks);
      if (result.verdict === "Incompatible") {
        return result;
      }
    }
    return { verdict: "Compatible" };
  }
}
```

**Notes d'adaptation obligatoires** :
- `PackageMetadataCache`/`ProjectTfmCache` : vérifier leurs API réelles ; si
  `invalidate(key)` n'existe pas, l'ajouter (suppression de l'entrée + test unitaire
  dans la suite du cache concerné). Idem `ProjectTfmCache.getCachedTfms(projectPath)` :
  exposer une lecture synchrone des TFMs déjà résolus pour la solution courante — si la
  forme réelle du cache s'y prête mal, résoudre les TFMs via `TfmResolver` comme le fait
  `GetPackageUpdateInfoQueryHandler.resolveProjectTfms` (copier ce motif), et adapter la
  signature du handler en le documentant dans le rapport.
- La casse/chemins d'imports doivent suivre les fichiers réels.

- [ ] **Step 4 : Vérifier le passage** — suite ciblée PASS (6 tests)

- [ ] **Step 5 : Commit**

```bash
npm run check-types && git add src/Host/Application/Handlers/Packages src/Host/Infrastructure src/Tests
git commit -m "feat: InstallPackageCommandHandler - installation par projet et globale - #Epic5

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7 : `UpgradePackageCommandHandler`

**Files:**
- Create: `src/Host/Application/Handlers/Packages/UpgradePackageCommandHandler.ts`
- Test: `src/Host/Application/Handlers/Packages/__tests__/UpgradePackageCommandHandler.test.ts`

**Interfaces:**
- Consumes: mêmes services que Task 6 (sans le verdict de garde — l'upgrade est demandé depuis une UI qui affiche déjà les verdicts ; MSBuild tranchera au restore)
- Produces: handler de `UpgradePackageCommand` → `PackageWriteResultDto` ; règles :
  - cible = `projectPath` fourni, sinon tous les projets où le package EST installé
  - legacy → skipped ; non installé sur la cible → skipped `"not installed"`
  - `CpmManaged` : UNE écriture `setVersionAttribute(cpmFile, "PackageVersion", id, version)` quel que soit le nombre de projets ; `affectedProjects` = tous les projets CPM qui le référencent ; un `projectPath` explicite sur un package CPM → refus `{ status: "Error", error: "géré centralement..." }` (l'UI désactive ce bouton, défense en profondeur)
  - `PackageReference` : `setVersionAttribute(csproj, "PackageReference", id, version)` par projet ; wildcard existant (`Version="8.*"`) → l'éditeur remplace la valeur telle quelle — le handler vérifie AVANT via `findItemElement` : si la version actuelle contient `*`, skipped `"wildcard version"` (exclusion du spec)
  - action globale multi-projets non-CPM → confirmation `IUserPrompt` (`"Update <id> to <version> on N projects?"`) ; le cas CPM (une écriture) → confirmation aussi si plusieurs projets affectés (`"...will affect N projects"`)
  - invalidation caches + `schedule` identiques à la Task 6

- [ ] **Step 1 : Tests qui échouent** — même socle ; cas complets à écrire : upgrade PackageReference par projet ; upgrade global multi-projets avec confirmation ; CPM une-écriture-N-projets-affectés avec confirmation ; `projectPath` sur CPM → Error ; wildcard → skipped ; non installé → skipped.
- [ ] **Step 2 : RED** ; **Step 3 : Implémenter** (structure identique au handler d'install : `selectTargets` filtre `installedVersion !== undefined`, branche CPM dédiée avant la boucle projets) ; **Step 4 : GREEN** ; **Step 5 : Commit** `feat: UpgradePackageCommandHandler - mise à jour par projet, globale et CPM solution-wide - #Epic5` + footer.

---

### Task 8 : `UninstallPackageCommandHandler`

**Files:**
- Create: `src/Host/Application/Handlers/Packages/UninstallPackageCommandHandler.ts`
- Test: `src/Host/Application/Handlers/Packages/__tests__/UninstallPackageCommandHandler.test.ts`

**Interfaces:**
- Consumes: mêmes services (sans verdict ni apiClient)
- Produces: handler de `UninstallPackageCommand` → `PackageWriteResultDto` ; règles :
  - cible = `projectPath` fourni, sinon tous les projets où installé ; legacy → skipped ; non installé → skipped
  - retrait de la `<PackageReference>` du csproj (styles PackageReference ET CpmManaged)
  - CPM : après les retraits, si plus AUCUN projet de la solution ne référence le package (re-résolution des targets post-écriture), retirer le `<PackageVersion>` orphelin du fichier CPM
  - action globale multi-projets → confirmation (`"Uninstall <id> from N projects?"`)
  - invalidation caches + `schedule` identiques

- [ ] **Step 1 : Tests qui échouent** — cas complets : uninstall par projet ; global avec confirmation ; CPM dernier consommateur → PackageVersion retiré (deux fichiers dans filesChanged) ; CPM avec consommateur restant → PackageVersion conservé ; non installé → skipped.
- [ ] **Step 2 : RED** ; **Step 3 : Implémenter** ; **Step 4 : GREEN, puis suite complète** `npx jest --coverage=false` (0 régression) ; **Step 5 : Commit** `feat: UninstallPackageCommandHandler - retrait par projet, global et nettoyage CPM orphelin - #Epic5` + footer.

---

### Task 9 : Enregistrements DI/WebMediator + `GetRestoreStatusQuery` + acceptance

**Files:**
- Create: `src/Host/Application/Handlers/Packages/GetRestoreStatusQueryHandler.ts`
- Modify: `src/Host/Application/DependencyInjection.ts` (ProvidePackages : + 4 handlers)
- Modify: `src/Host/Infrastructure/DependencyInjection.ts` (+ `this.Register<IUserPrompt>(USER_PROMPT, VscUserPrompt)` et `this.Register<IProcessRunner>(PROCESS_RUNNER, ChildProcessRunner)` — suivre le motif des Register existants)
- Modify: `src/Host/Presentation/nugetWebviewProvider.ts` (+ 4 `registerRequestType`)
- Test: `src/Tests/Acceptances/__tests__/PackageWrites.acceptance.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède
- Produces: `GetRestoreStatusQueryHandler` (`@injectable` + `@HandlerFor(GetRestoreStatusQuery)`, retourne `this.restoreScheduler.getStatus()`) ; commands invocables depuis la webview

- [ ] **Step 1 : Handler de statut** (8 lignes, pas de test dédié — couvert par l'acceptance)
- [ ] **Step 2 : Enregistrements** (imports + `RegisterClass`/`Register` + `registerRequestType('InstallPackageCommand', InstallPackageCommand)` etc.)
- [ ] **Step 3 : Acceptance test** — scénario complet sur fixtures fs mockées (socle Task 5) avec handlers réels, `ProcessRunner` factice injecté dans un `RestoreScheduler` réel, prompt factice acceptant : installer Serilog sur Core (vérifier le contenu écrit du csproj), puis upgrader (contenu re-vérifié), puis désinstaller (référence disparue) ; à chaque étape le mock fs est mis à jour avec le contenu écrit pour que l'étape suivante reparte de l'état réel ; vérifier que `GetRestoreStatusQuery` reflète le cycle Running→Succeeded (fake timers).
- [ ] **Step 4 : Suite complète** `npx jest --coverage=false` → 0 régression ; `npm run check-types`
- [ ] **Step 5 : Commit** `feat: Câblage DI et WebMediator des écritures + scénario d'acceptance - #Epic5` + footer.

---

### Task 10 : UI — activation des boutons et états occupés

**Files:**
- Modify: `src/Web/Features/Packages/PackagesView.ts`
- Modify: `src/Web/Features/Packages/PackageDetail.ts`
- Modify: `src/Web/Features/Packages/ProjectInstallations.ts`

**Interfaces:**
- Consumes: les 3 commands + `PackageWriteResultDto` (Task 3) ; motif d'envoi : `this.dispatcher.Send(new InstallPackageCommand(...)) as Promise<PackageWriteResultDto>` (même cast que les queries existantes)
- Produces: événements `install-package { projectPath? }`, `upgrade-package { projectPath?, version }`, `uninstall-package { projectPath? }` émis par `ProjectInstallations`/`PackageDetail` (CustomEvent bubbles+composed, comme `package-selected`) ; `PackagesView.onWriteCommand` centralise l'envoi ; état `busyProjects: Set<string>` + `globalBusy: boolean` passé aux enfants ; après réponse : recharge `GetSolutionPackagesQuery` + re-fetch du package sélectionné + stocke `lastWriteResult` (pour le bandeau Task 11)

Comportements :
- `ProjectInstallations` : dégriser ⇧/🗑/＋ pour styles `PackageReference` ; sous `CpmManaged` : ＋/🗑 actifs, ⇧ reste désactivé avec tooltip i18n `packages.installations.cpmManagedTooltip` (« géré centralement — utilisez la mise à jour globale ») ; `PackagesConfig` : tout reste désactivé (tooltip legacy existant) ; bouton cliqué → spinner (`ellipsisIcon`) + boutons de la carte désactivés tant que `busyProjects` contient le projet
- `PackageDetail` toolbar : ＋/⇧/🗑 globaux actifs (la confirmation est côté Host) ; pendant `globalBusy`, les trois sont désactivés
- ⇧ envoie la version sélectionnée dans le sélecteur (`currentVersion.version`)
- Après réponse `status: "Error"` → le bandeau (Task 11) affichera `error` ; pas d'état d'erreur bloquant dans les cartes

- [ ] **Step 1 : Implémenter** (événements enfants → handler central `PackagesView`) ; **Step 2 : Vérifier** `npm run check-types && npm run build` (exit 0) ; **Step 3 : Commit** `feat: Activation des actions d'écriture dans la vue packages - #Epic5` + footer.

---

### Task 11 : UI — bandeau restore + résultat d'écriture + i18n

**Files:**
- Create: `src/Web/Features/Packages/WriteStatusBanner.ts`
- Modify: `src/Web/Features/Packages/PackagesView.ts` (polling + état bannière)
- Modify: `src/Web/i18n/locales/fr.json` + `en.json`

**Interfaces:**
- Consumes: `GetRestoreStatusQuery`/`RestoreStatusDto`, `lastWriteResult` (Task 10)
- Produces: `<write-status-banner .restore=${RestoreStatusDto|undefined} .writeResult=${PackageWriteResultDto|undefined}>` affiché entre la toolbar et le corps du détail

Comportements :
- après chaque commande d'écriture : polling `GetRestoreStatusQuery` toutes les 1 s, arrêt sur état terminal dont le `runId` ≥ celui observé au premier poll, ou après 60 s
- bannière : `Running` → spinner + `packages.restore.running` (« Restore en cours… ») ; `Succeeded` → check vert + `packages.restore.succeeded`, auto-masqué après 4 s ; `Failed` → croix rouge persistante + messages dans un `<details>` dépliable
- les `skipped` du dernier `PackageWriteResultDto` s'affichent dans la même bannière : `packages.write.skipped` (« {count} projet(s) ignoré(s) : ») + raisons jointes ; `status: "Error"` → message d'erreur direct
- clés i18n nouvelles (fr/en) : `packages.restore.running/succeeded/failed`, `packages.write.skipped/error`, `packages.installations.cpmManagedTooltip` — fr d'abord, en traduit naturellement

- [ ] **Step 1 : Implémenter** ; **Step 2 : Vérifier** `npx jest --coverage=false && npm run check-types && npm run lint && npm run build` (tout vert) ; **Step 3 : Commit** `feat: Bandeau de statut restore et résultat des écritures - #Epic5` + footer.

---

### Task 12 : Vérification manuelle F5 (avant merge)

Aucun fichier — checklist humaine (l'exécuteur s'arrête ici et la remet à Victor) :

1. F5, solution réelle. Installer un package sur un projet non équipé → csproj modifié proprement (indentation intacte), bandeau « Restore en cours… » puis ✔
2. Upgrade par projet (non-CPM) → version changée dans le csproj, restore OK
3. Upgrade global d'un package CPM → confirmation « affectera N projets », UNE modification dans Directory.Packages.props
4. Désinstallation du dernier consommateur d'un package CPM → PackageVersion retiré aussi
5. Action refusée (annuler la confirmation) → aucun fichier modifié
6. Cas d'échec restore (installer une version inexistante en modifiant à la main ?) → bandeau ✖ avec erreurs NU dépliables
7. Projet legacy → boutons désactivés, tooltip explicite
8. `git diff` sur la solution de test : uniquement les lignes attendues, aucun churn de formatage

---

## Auto-revue du plan

- **Couverture du spec** : chirurgie (T1-T2, contrat `{ok}`/byte-identique/CRLF/BOM/ItemGroup conditionné/tri), contrats (T3), restore débouncé+sérialisé+timeout+SDK absent+parsing NU/MSB (T4), cibles+styles+CPM le plus proche (T5), confirmation modale Host (T5/T6-T8), matrice install/upgrade/uninstall × styles + garde-fous verdict/wildcard/orphelin (T6-T8), statut par query + DI + acceptance (T9), UI boutons/spinners/CPM-tooltip (T10), bandeau+polling+skipped+i18n (T11), F5 avant merge (T12). Écart consigné : les confirmations Host sont en anglais en v1 (les strings Host ne sont pas i18n-isées aujourd'hui — les messages `dotnet`/logs non plus) ; à revisiter avec l'i18n Host.
- **Placeholders** : les Tasks 7 et 8 décrivent les tests par cas nommés complets plutôt que par code intégral — le comportement attendu de chaque cas est spécifié dans leurs blocs Interfaces/règles, et la structure d'implémentation est celle, complète, de la Task 6 ; l'implémenteur des T7/T8 reçoit la T6 comme référence de motif dans son brief. Notes d'adaptation explicites partout où une API réelle doit être vérifiée (InjectionToken, caches `invalidate`, mock vscode.window).
- **Cohérence de types** : `EditResult`/`WriteTarget`/`PackageWriteResultDto`/`RestoreStatusDto` définis une fois (T1/T3/T5) et consommés tels quels ; clé de cache métadonnées `${solutionPath}::${id.toLowerCase()}` alignée sur celle du handler UpdateInfo de l'Epic 2.
