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
    const result = editor.addItemElement(unsorted, "PackageReference", {
      Include: "Beta",
      Version: "1.0.0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.content.split("\n");
      const idx = lines.findIndex((l) => l.includes('Include="Beta"'));
      expect(lines[idx - 1]).toContain('Include="Zulu"');
    }
  });

  it("crée un ItemGroup neuf s'il n'existe aucun élément du type, avant </Project>", () => {
    const noRefs = `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n`;
    const result = editor.addItemElement(noRefs, "PackageReference", {
      Include: "X",
      Version: "1.0.0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain(
        `  <ItemGroup>\n    <PackageReference Include="X" Version="1.0.0" />\n  </ItemGroup>\n</Project>`,
      );
    }
  });

  it("n'insère jamais dans un ItemGroup conditionné", () => {
    const conditioned = `<Project>\n  <ItemGroup Condition="'$(TargetFramework)' == 'net8.0'">\n    <PackageReference Include="Alpha" Version="1.0.0" />\n  </ItemGroup>\n</Project>\n`;
    const result = editor.addItemElement(conditioned, "PackageReference", {
      Include: "Beta",
      Version: "1.0.0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Un nouvel ItemGroup non conditionné a été créé
      const groups = result.content.match(/<ItemGroup/g);
      expect(groups).toHaveLength(2);
      expect(result.content.indexOf('Include="Beta"')).toBeGreaterThan(
        result.content.indexOf("</ItemGroup>"),
      );
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
    expect(
      editor.addItemElement(CSPROJ, "PackageReference", { Include: "alpha", Version: "9" }).ok,
    ).toBe(false);
  });

  it("refuse toute valeur d'attribut contenant un caractère d'injection XML (Finding 3b)", () => {
    expect(
      editor.addItemElement(CSPROJ, "PackageReference", {
        Include: 'Evil" Foo="bar',
        Version: "1.0.0",
      }).ok,
    ).toBe(false);
    expect(
      editor.addItemElement(CSPROJ, "PackageReference", { Include: "Evil", Version: "1.0.0<x>" })
        .ok,
    ).toBe(false);
    expect(
      editor.addItemElement(CSPROJ, "PackageReference", { Include: "Evil'", Version: "1.0.0" }).ok,
    ).toBe(false);
    expect(
      editor.addItemElement(CSPROJ, "PackageReference", { Include: "Evil&Co", Version: "1.0.0" })
        .ok,
    ).toBe(false);
  });

  it("tolère une Condition avec > dans la valeur", () => {
    const conditionWithGt = `<Project>\n  <ItemGroup Condition="'$(X)' > '1'">\n    <PackageReference Include="Alpha" Version="1.0.0" />\n  </ItemGroup>\n</Project>\n`;
    const result = editor.addItemElement(conditionWithGt, "PackageReference", {
      Include: "Beta",
      Version: "1.0.0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Insertion dans un nouvel ItemGroup non conditionné, pas dans celui conditionné
      const groups = result.content.match(/<ItemGroup/g);
      expect(groups).toHaveLength(2);
      expect(result.content.indexOf('Include="Beta"')).toBeGreaterThan(
        result.content.indexOf("</ItemGroup>"),
      );
    }
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

  it("supprime l'ItemGroup devenu vide (byte-exact)", () => {
    const single = CSPROJ.replace(`    <PackageReference Include="Zulu" Version="2.0.0" />\n`, "");
    const result = editor.removeItemElement(single, "PackageReference", "Alpha");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const expected = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
`;
      expect(result.content).toBe(expected);
    }
  });

  it("échoue proprement si l'élément est introuvable", () => {
    expect(editor.removeItemElement(CSPROJ, "PackageReference", "Inconnu").ok).toBe(false);
  });

  it("préserve un groupe conditionné vide pré-existant lors de la suppression", () => {
    const withConditionedEmpty = `<Project>\n  <ItemGroup Condition="'$(TargetFramework)' == 'net7.0'">\n  </ItemGroup>\n  <ItemGroup>\n    <PackageReference Include="Alpha" Version="1.0.0" />\n    <PackageReference Include="Zulu" Version="2.0.0" />\n  </ItemGroup>\n</Project>\n`;
    const result = editor.removeItemElement(withConditionedEmpty, "PackageReference", "Alpha");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Le groupe conditionné vide subsiste (byte-identique)
      expect(result.content).toContain("Condition=\"'$(TargetFramework)' == 'net7.0'\"");
      expect(result.content).not.toContain("Alpha");
      expect(result.content).toContain('Include="Zulu"');
    }
  });

  it("supprime tous les éléments correspondants et nettoie les groupes vidés (byte-exact)", () => {
    const multiGroup = `<Project>\n  <ItemGroup>\n    <PackageReference Include="Alpha" Version="1.0.0" />\n  </ItemGroup>\n  <ItemGroup>\n    <PackageReference Include="Alpha" Version="2.0.0" />\n  </ItemGroup>\n</Project>\n`;
    const result = editor.removeItemElement(multiGroup, "PackageReference", "Alpha");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const expected = "<Project>\n</Project>\n";
      expect(result.content).toBe(expected);
    }
  });
});

describe("MsBuildTextEditor - forme bloc (Finding 1)", () => {
  const editor = new MsBuildTextEditor();

  const BLOCK_FORM_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Alpha" Version="1.0.0">
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
    <PackageReference Include="Zulu" Version="2.0.0" />
  </ItemGroup>
</Project>
`;

  it("removeItemElement : supprime le bloc ENTIER (balise ouvrante + enfants + balise fermante), pas seulement la ligne d'ouverture", () => {
    const result = editor.removeItemElement(BLOCK_FORM_CSPROJ, "PackageReference", "Alpha");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).not.toContain("Alpha");
      expect(result.content).not.toContain("<PrivateAssets>");
      expect(result.content).not.toContain(
        '</PackageReference>\n    <PackageReference Include="Zulu"',
      );
      const expected = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Zulu" Version="2.0.0" />
  </ItemGroup>
</Project>
`;
      expect(result.content).toBe(expected);
    }
  });

  it("removeItemElement : un ItemGroup ne contenant qu'un élément bloc devient vide et est purgé (byte-exact)", () => {
    const single = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Alpha" Version="1.0.0">
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>
</Project>
`;
    const result = editor.removeItemElement(single, "PackageReference", "Alpha");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const expected = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
`;
      expect(result.content).toBe(expected);
    }
  });

  it("addItemElement : insère APRÈS la balise fermante d'un dernier sibling en forme bloc, jamais à l'intérieur", () => {
    const singleBlock = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Alpha" Version="1.0.0">
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>
</Project>
`;
    const result = editor.addItemElement(singleBlock, "PackageReference", {
      Include: "Zulu",
      Version: "2.0.0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Jamais entre <PrivateAssets> et </PackageReference> : toujours après.
      expect(result.content).not.toContain(
        '<PrivateAssets>all</PrivateAssets>\n      <PackageReference Include="Zulu"',
      );
      const zuluIdx = result.content.indexOf('Include="Zulu"');
      const closingIdx = result.content.indexOf("</PackageReference>");
      expect(closingIdx).toBeGreaterThan(-1);
      expect(zuluIdx).toBeGreaterThan(closingIdx);
      const lines = result.content.split("\n");
      const idx = lines.findIndex((l) => l.includes('Include="Zulu"'));
      expect(lines[idx]).toBe('    <PackageReference Include="Zulu" Version="2.0.0" />');
    }
  });

  it("supprime tous les éléments correspondants en mixant forme bloc et forme auto-fermante, nettoie les deux groupes vidés (byte-exact)", () => {
    const mixed = `<Project>
  <ItemGroup>
    <PackageReference Include="Alpha" Version="1.0.0" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Alpha" Version="2.0.0">
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>
</Project>
`;
    const result = editor.removeItemElement(mixed, "PackageReference", "Alpha");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe("<Project>\n</Project>\n");
    }
  });
});
