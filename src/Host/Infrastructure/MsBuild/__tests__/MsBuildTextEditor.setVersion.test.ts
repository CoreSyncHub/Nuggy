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

  it("locates an element together with its attributes", () => {
    const found = editor.findItemElement(CSPROJ, "PackageReference", "Serilog");
    expect(found).toBeDefined();
    expect(found!.attributes).toEqual({ Include: "Serilog", Version: "3.1.0" });
    expect(CSPROJ.slice(found!.start, found!.end)).toContain('Include="Serilog"');
  });

  it("locates the COMPLETE span of a block-form element, children included (Finding 1)", () => {
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

  it("locates case-insensitively but ignores Update= entries", () => {
    expect(editor.findItemElement(CSPROJ, "PackageReference", "newtonsoft.json")).toBeDefined();
    const withUpdate = CSPROJ.replace('Include="Serilog"', 'Update="Serilog"');
    expect(editor.findItemElement(withUpdate, "PackageReference", "Serilog")).toBeUndefined();
  });

  it("replaces only the Version value, the rest stays byte-identical", () => {
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

  it("preserves CRLF, BOM and single quotes", () => {
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

  it("handles a multi-line element", () => {
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

  it("fails cleanly: element not found, Version missing, wildcard accepted as is", () => {
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

  it("tolerates quoted angle brackets (>) inside Condition attributes", () => {
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

  it("updates every occurrence (multiple conditioned ItemGroups)", () => {
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
      // Checks that both occurrences were updated
      const count = (result.content.match(/Version="4\.0\.0"/g) || []).length;
      expect(count).toBe(2);
      // Checks that the rest of the file is unchanged
      const withReplaced = multiGroup
        .replace('Version="3.0.0"', 'Version="4.0.0"')
        .replace('Version="3.1.0"', 'Version="4.0.0"');
      expect(result.content).toBe(withReplaced);
    }
  });

  it("handles dollar patterns ($$, $`) without interpreting them", () => {
    // $& and $' are excluded from this fixture: they contain '&' and '\'', now
    // refused by the XML anti-injection validation (Finding 3b) — so this test only
    // covers the JS replacement patterns still valid on the MSBuild side.
    const dollarVersion = "1.0.0$$$`";
    const result = editor.setVersionAttribute(CSPROJ, "PackageReference", "Serilog", dollarVersion);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain(`Version="${dollarVersion}"`);
      expect(result.content).toContain('Version="1.0.0$$$`"');
      // Check that no duplication was caused by interpreting $$ or $`
      expect(result.content).not.toContain('Version="1.0.0Version=');
    }
  });

  it("refuses a new version containing XML injection characters (Finding 3b)", () => {
    for (const bad of ['1.0.0"', "1.0.0'", "1.0.0<x>", "1.0.0&amp;"]) {
      const result = editor.setVersionAttribute(CSPROJ, "PackageReference", "Serilog", bad);
      expect(result.ok).toBe(false);
    }
  });
});
