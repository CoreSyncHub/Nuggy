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

  it("inserts alphabetically into the existing ItemGroup, copying the indentation", () => {
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

  it("inserts after the last one when the existing entries are not sorted", () => {
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

  it("creates a fresh ItemGroup when no element of that type exists, before </Project>", () => {
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

  it("never inserts into a conditioned ItemGroup", () => {
    const conditioned = `<Project>\n  <ItemGroup Condition="'$(TargetFramework)' == 'net8.0'">\n    <PackageReference Include="Alpha" Version="1.0.0" />\n  </ItemGroup>\n</Project>\n`;
    const result = editor.addItemElement(conditioned, "PackageReference", {
      Include: "Beta",
      Version: "1.0.0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // A new unconditioned ItemGroup was created
      const groups = result.content.match(/<ItemGroup/g);
      expect(groups).toHaveLength(2);
      expect(result.content.indexOf('Include="Beta"')).toBeGreaterThan(
        result.content.indexOf("</ItemGroup>"),
      );
    }
  });

  it("inserts without a Version attribute (CPM style) and preserves CRLF", () => {
    const crlf = CSPROJ.replace(/\n/g, "\r\n");
    const result = editor.addItemElement(crlf, "PackageReference", { Include: "Middle" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('<PackageReference Include="Middle" />\r\n');
    }
  });

  it("refuses a duplicate (same Include, case-insensitive)", () => {
    expect(
      editor.addItemElement(CSPROJ, "PackageReference", { Include: "alpha", Version: "9" }).ok,
    ).toBe(false);
  });

  it("refuses any attribute value containing an XML injection character (Finding 3b)", () => {
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

  it("tolerates a Condition holding a > in its value", () => {
    const conditionWithGt = `<Project>\n  <ItemGroup Condition="'$(X)' > '1'">\n    <PackageReference Include="Alpha" Version="1.0.0" />\n  </ItemGroup>\n</Project>\n`;
    const result = editor.addItemElement(conditionWithGt, "PackageReference", {
      Include: "Beta",
      Version: "1.0.0",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Inserted into a new unconditioned ItemGroup, not into the conditioned one
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

  it("removes the element's line", () => {
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

  it("fails cleanly when the element cannot be found", () => {
    expect(editor.removeItemElement(CSPROJ, "PackageReference", "Inconnu").ok).toBe(false);
  });

  it("preserves a pre-existing empty conditioned group on removal", () => {
    const withConditionedEmpty = `<Project>\n  <ItemGroup Condition="'$(TargetFramework)' == 'net7.0'">\n  </ItemGroup>\n  <ItemGroup>\n    <PackageReference Include="Alpha" Version="1.0.0" />\n    <PackageReference Include="Zulu" Version="2.0.0" />\n  </ItemGroup>\n</Project>\n`;
    const result = editor.removeItemElement(withConditionedEmpty, "PackageReference", "Alpha");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The empty conditioned group survives (byte-identical)
      expect(result.content).toContain("Condition=\"'$(TargetFramework)' == 'net7.0'\"");
      expect(result.content).not.toContain("Alpha");
      expect(result.content).toContain('Include="Zulu"');
    }
  });

  it("removes every matching element and cleans up the emptied groups (byte-exact)", () => {
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

  it("removeItemElement: removes the ENTIRE block (opening tag + children + closing tag), not just the opening line", () => {
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

  it("removeItemElement: an ItemGroup holding a single block element becomes empty and is purged (byte-exact)", () => {
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

  it("addItemElement: inserts AFTER the closing tag of a last block-form sibling, never inside it", () => {
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
      // Never between <PrivateAssets> and </PackageReference>: always after.
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

  it("removes every matching element mixing block and self-closing forms, cleans up both emptied groups (byte-exact)", () => {
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
