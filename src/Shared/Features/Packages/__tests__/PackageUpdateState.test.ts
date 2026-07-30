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

/** Chaque version est décrite par ses verdicts : { projet → verdict }. */
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
  it("signale une mise à jour quand une version plus récente est compatible partout", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0")),
      info([
        { version: "4.0.0", verdicts: { [API]: "Compatible" } },
        { version: "3.0.0", verdicts: { [API]: "Compatible" } },
      ]),
    );
    expect(state).toBe<PackageUpdateState>("update");
  });

  it("est à jour quand aucune version n'est plus récente que celle installée", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "4.0.0")),
      info([
        { version: "4.0.0", verdicts: { [API]: "Compatible" } },
        { version: "3.0.0", verdicts: { [API]: "Compatible" } },
      ]),
    );
    expect(state).toBe<PackageUpdateState>("upToDate");
  });

  it("compare à la PLUS BASSE des versions installées : un projet en retard reste montable", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0"), installation(LEGACY, "4.0.0")),
      info([
        { version: "4.0.0", verdicts: { [API]: "Compatible", [LEGACY]: "Compatible" } },
        { version: "3.0.0", verdicts: { [API]: "Compatible", [LEGACY]: "Compatible" } },
      ]),
    );
    expect(state).toBe<PackageUpdateState>("update");
  });

  it("signale une mise à jour partielle quand seuls certains projets peuvent monter", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0"), installation(LEGACY, "3.0.0")),
      info([{ version: "4.0.0", verdicts: { [API]: "Compatible", [LEGACY]: "Incompatible" } }]),
    );
    expect(state).toBe<PackageUpdateState>("updatePartial");
  });

  it("signale « hors TFM » quand des versions plus récentes existent sans être compatibles", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0")),
      info([{ version: "4.0.0", verdicts: { [API]: "Incompatible" } }]),
    );
    expect(state).toBe<PackageUpdateState>("outOfTfm");
  });

  it("ne tient compte que des projets où le package est installé", () => {
    // Le verdict Incompatible d'un projet qui n'a PAS le package ne doit pas
    // dégrader l'état : une mise à jour ne touche que les projets concernés.
    const other = "/Solution/Other/Other.csproj";
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0")),
      info([{ version: "4.0.0", verdicts: { [API]: "Compatible", [other]: "Incompatible" } }]),
    );
    expect(state).toBe<PackageUpdateState>("update");
  });

  it("ignore les préversions tant qu'aucune version installée n'en est une", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0")),
      info([
        { version: "4.0.0-beta.1", verdicts: { [API]: "Compatible" } },
        { version: "3.0.0", verdicts: { [API]: "Compatible" } },
      ]),
    );
    expect(state).toBe<PackageUpdateState>("upToDate");
  });

  it("prend les préversions en compte quand une version installée en est déjà une", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0-beta.1")),
      info([
        { version: "3.0.0-beta.2", verdicts: { [API]: "Compatible" } },
        { version: "3.0.0-beta.1", verdicts: { [API]: "Compatible" } },
      ]),
    );
    expect(state).toBe<PackageUpdateState>("update");
  });

  it("est inconnu quand les métadonnées n'ont pas pu être récupérées", () => {
    const state = resolvePackageUpdateState(pkg(installation(API, "3.0.0")), info([], "Offline"));
    expect(state).toBe<PackageUpdateState>("unknown");
  });

  it("est inconnu quand un verdict manque pour un projet installé", () => {
    // Verdicts absents (TFM non résolu, projet ajouté entre deux requêtes) :
    // ne jamais affirmer « à jour » ni « hors TFM » sur une information partielle.
    const state = resolvePackageUpdateState(
      pkg(installation(API, "3.0.0")),
      info([{ version: "4.0.0", verdicts: {} }]),
    );
    expect(state).toBe<PackageUpdateState>("unknown");
  });

  it("est inconnu quand la version installée n'est pas résolue", () => {
    const state = resolvePackageUpdateState(
      pkg(installation(API, "unknown")),
      info([{ version: "4.0.0", verdicts: { [API]: "Compatible" } }]),
    );
    expect(state).toBe<PackageUpdateState>("unknown");
  });

  it("classe les états du plus actionnable au moins actionnable", () => {
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
