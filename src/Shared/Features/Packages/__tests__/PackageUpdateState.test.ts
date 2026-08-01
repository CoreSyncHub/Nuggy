import {
  resolvePackageUpdateState,
  UPDATE_STATE_RANK,
  type PackageUpdateState,
} from "../PackageUpdateState";
import {
  type PackageInstallationDto,
  type SolutionPackageDto,
} from "@Shared/Features/Dtos/SolutionPackagesDto";
import {
  type CompatibilityVerdict,
  type PackageUpdateInfoDto,
} from "@Shared/Features/Dtos/PackageUpdateInfoDto";

const API = "/Solution/Api/Api.csproj";
const LEGACY = "/Solution/Legacy/Legacy.csproj";

function installation(projectPath: string, installedVersion: string): PackageInstallationDto {
  return {
    projectPath,
    projectName: projectPath.split("/").pop()!,
    effectiveTfms: ["net8.0"],
    installedVersion,
    referenceStyle: "PackageReference",
  };
}

function pkg(...installations: PackageInstallationDto[]): SolutionPackageDto {
  return { id: "Serilog", iconUrl: "", installations };
}

/** Each version is described by its verdicts: { project → verdict }. */
function info(
  versions: Array<{ version: string; verdicts: Record<string, CompatibilityVerdict> }>,
  fetchStatus: PackageUpdateInfoDto["fetchStatus"] = "Ok",
): PackageUpdateInfoDto {
  return {
    id: "Serilog",
    verified: false,
    isMicrosoft: false,
    authors: "",
    tags: [],
    links: { nugetPage: "" },
    fetchStatus,
    versions: versions.map((v) => ({
      version: v.version,
      isPrerelease: v.version.includes("-"),
      dependencyGroups: [],
      verdictsByProject: Object.entries(v.verdicts).map(([projectPath, verdict]) => ({
        projectPath,
        verdict,
      })),
    })),
  };
}

describe("resolvePackageUpdateState", () => {
  it("reports an update when a newer version is compatible everywhere", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0")),
      info([
        { version: "4.0.0", verdicts: { [API]: "Compatible" } },
        { version: "3.0.0", verdicts: { [API]: "Compatible" } },
      ]),
    );
    expect(state).toBe<PackageUpdateState>("update");
  });

  it("is up to date when no version is newer than the installed one", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "4.0.0")),
      info([
        { version: "4.0.0", verdicts: { [API]: "Compatible" } },
        { version: "3.0.0", verdicts: { [API]: "Compatible" } },
      ]),
    );
    expect(state).toBe<PackageUpdateState>("upToDate");
  });

  it("compares against the LOWEST installed version: a project left behind stays upgradable", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0"), installation(LEGACY, "4.0.0")),
      info([
        { version: "4.0.0", verdicts: { [API]: "Compatible", [LEGACY]: "Compatible" } },
        { version: "3.0.0", verdicts: { [API]: "Compatible", [LEGACY]: "Compatible" } },
      ]),
    );
    expect(state).toBe<PackageUpdateState>("update");
  });

  it("reports a partial update when only some projects can move up", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0"), installation(LEGACY, "3.0.0")),
      info([{ version: "4.0.0", verdicts: { [API]: "Compatible", [LEGACY]: "Incompatible" } }]),
    );
    expect(state).toBe<PackageUpdateState>("updatePartial");
  });

  it('reports "out of TFM" when newer versions exist but none is compatible', () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0")),
      info([{ version: "4.0.0", verdicts: { [API]: "Incompatible" } }]),
    );
    expect(state).toBe<PackageUpdateState>("outOfTfm");
  });

  it("only takes into account the projects where the package is installed", () => {
    // The Incompatible verdict of a project that does NOT have the package must not
    // degrade the state: an update only touches the projects concerned.
    const other = "/Solution/Other/Other.csproj";
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0")),
      info([{ version: "4.0.0", verdicts: { [API]: "Compatible", [other]: "Incompatible" } }]),
    );
    expect(state).toBe<PackageUpdateState>("update");
  });

  it("ignores prereleases as long as no installed version is one", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0")),
      info([
        { version: "4.0.0-beta.1", verdicts: { [API]: "Compatible" } },
        { version: "3.0.0", verdicts: { [API]: "Compatible" } },
      ]),
    );
    expect(state).toBe<PackageUpdateState>("upToDate");
  });

  it("takes prereleases into account when an installed version already is one", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0-beta.1")),
      info([
        { version: "3.0.0-beta.2", verdicts: { [API]: "Compatible" } },
        { version: "3.0.0-beta.1", verdicts: { [API]: "Compatible" } },
      ]),
    );
    expect(state).toBe<PackageUpdateState>("update");
  });

  it("is unknown when the metadata could not be fetched", () => {
    const state = resolvePackageUpdateState(pkg(installation(API, "3.0.0")), info([], "Offline"));
    expect(state).toBe<PackageUpdateState>("unknown");
  });

  it("is unknown when a verdict is missing for an installed project", () => {
    // Missing verdicts (unresolved TFM, project added between two requests):
    // never assert "up to date" nor "out of TFM" on partial information.
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0")),
      info([{ version: "4.0.0", verdicts: {} }]),
    );
    expect(state).toBe<PackageUpdateState>("unknown");
  });

  it("is unknown when the installed version is unresolved", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "unknown")),
      info([{ version: "4.0.0", verdicts: { [API]: "Compatible" } }]),
    );
    expect(state).toBe<PackageUpdateState>("unknown");
  });

  it("ranks the states from most to least actionable", () => {
    const states: PackageUpdateState[] = [
      "unknown",
      "upToDate",
      "outOfTfm",
      "updatePartial",
      "update",
    ];
    expect([...states].sort((a, b) => UPDATE_STATE_RANK[a] - UPDATE_STATE_RANK[b])).toEqual([
      "update",
      "updatePartial",
      "outOfTfm",
      "upToDate",
      "unknown",
    ]);
  });
});
