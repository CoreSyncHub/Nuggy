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

  it("localise le span COMPLET d'un élément en forme bloc, enfants inclus (Finding 1)", () => {
    const blockForm = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Serilog" Version="3.1.0">
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>
</Project>
`;
    const found = editor.findItemElement(blockForm, "PackageReference", "Serilog");
    expect(found).toBeDefined();
    expect(blockForm.slice(found!.start, found!.end)).toBe(
      '<PackageReference Include="Serilog" Version="3.1.0">\n      <PrivateAssets>all</PrivateAssets>\n    </PackageReference>',
    );
  });

  it("localise insensiblement à la casse mais ignore les Update=", () => {
    expect(editor.findItemElement(CSPROJ, "PackageReference", "newtonsoft.json")).toBeDefined();
    const withUpdate = CSPROJ.replace('Include="Serilog"', 'Update="Serilog"');
    expect(editor.findItemElement(withUpdate, "PackageReference", "Serilog")).toBeUndefined();
  });

  it("remplace uniquement la valeur de Version, reste byte-identique", () => {
    const result = editor.setVersionAttribute(
      CSPROJ,
      "PackageReference",
      "Newtonsoft.Json",
      "13.0.4",
    );
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
      '<PackageReference Include="Serilog"\n                      Version="3.1.0" />',
    );
    const result = editor.setVersionAttribute(multi, "PackageReference", "Serilog", "4.0.0");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Version="4.0.0"');
    }
  });

  it("échoue proprement : élément introuvable, Version absente, wildcard accepté tel quel", () => {
    expect(editor.setVersionAttribute(CSPROJ, "PackageReference", "Inconnu", "1.0.0").ok).toBe(
      false,
    );
    const noVersion = CSPROJ.replace(' Version="3.1.0"', "");
    expect(editor.setVersionAttribute(noVersion, "PackageReference", "Serilog", "4.0.0").ok).toBe(
      false,
    );
  });

  it("fonctionne pour PackageVersion (fichier CPM)", () => {
    const cpm = `<Project>\n  <ItemGroup>\n    <PackageVersion Include="Serilog" Version="3.1.0" />\n  </ItemGroup>\n</Project>\n`;
    const result = editor.setVersionAttribute(cpm, "PackageVersion", "Serilog", "4.0.0");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('<PackageVersion Include="Serilog" Version="4.0.0" />');
    }
  });

  it("tolère les chevrons (>) quotés dans les attributs Condition", () => {
    const withCondition = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Serilog" Condition="'$(TargetFramework)' > 'net6.0'" Version="3.1.0" />
  </ItemGroup>
</Project>
`;
    const result = editor.setVersionAttribute(
      withCondition,
      "PackageReference",
      "Serilog",
      "4.0.0",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Version="4.0.0"');
      expect(result.content).toContain("Condition=\"'$(TargetFramework)' > 'net6.0'\"");
    }
  });

  it("met à jour toutes les occurrences (multi-ItemGroups conditionnés)", () => {
    const multiGroup = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup Condition="'$(TargetFramework)' == 'net6.0'">
    <PackageReference Include="Serilog" Version="3.0.0" />
  </ItemGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net8.0'">
    <PackageReference Include="Serilog" Version="3.1.0" />
  </ItemGroup>
</Project>
`;
    const result = editor.setVersionAttribute(multiGroup, "PackageReference", "Serilog", "4.0.0");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Vérifie que les deux occurrences ont été mises à jour
      const count = (result.content.match(/Version="4\.0\.0"/g) || []).length;
      expect(count).toBe(2);
      // Vérifie que le reste du fichier est identique
      const withReplaced = multiGroup
        .replace('Version="3.0.0"', 'Version="4.0.0"')
        .replace('Version="3.1.0"', 'Version="4.0.0"');
      expect(result.content).toBe(withReplaced);
    }
  });

  it("gère les motifs dollar ($$, $`) sans interprétation", () => {
    // $& et $' sont exclus de ce fixture : ils contiennent '&' et '\'', désormais
    // refusés par la validation anti-injection XML (Finding 3b) — ce test ne
    // couvre donc que les motifs de remplacement JS encore valides côté MSBuild.
    const dollarVersion = "1.0.0$$$`";
    const result = editor.setVersionAttribute(CSPROJ, "PackageReference", "Serilog", dollarVersion);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain(`Version="${dollarVersion}"`);
      expect(result.content).toContain('Version="1.0.0$$$`"');
      // Vérifier qu'il n'y a pas de duplication causée par l'interprétation de $$ ou $`
      expect(result.content).not.toContain('Version="1.0.0Version=');
    }
  });

  it("refuse une nouvelle version contenant des caractères d'injection XML (Finding 3b)", () => {
    for (const bad of ['1.0.0"', "1.0.0'", "1.0.0<x>", "1.0.0&amp;"]) {
      const result = editor.setVersionAttribute(CSPROJ, "PackageReference", "Serilog", bad);
      expect(result.ok).toBe(false);
    }
  });
});
