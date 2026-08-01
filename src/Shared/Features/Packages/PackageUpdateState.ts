import { type SolutionPackageDto } from "../Dtos/SolutionPackagesDto";
import {
  type PackageUpdateInfoDto,
  type PackageVersionInfoDto,
} from "../Dtos/PackageUpdateInfoDto";
import { compareVersionsDesc } from "../Versions/CompareVersions";

/**
 * What an already-installed package has left to gain — the useful question on
 * an existing solution, where "is the latest version compatible?" says nothing
 * actionable.
 *
 * - `update`: a newer version is compatible with every project that carries the
 *   package — upgradable right away.
 * - `updatePartial`: a newer version is compatible with only some of the
 *   projects (solution with heterogeneous TFMs).
 * - `outOfTfm`: newer versions exist, none for the TFMs in place. Information,
 *   not an anomaly: staying on an LTS while an ecosystem publishes for the next
 *   version is a legitimate choice.
 * - `upToDate`: nothing newer.
 * - `unknown`: metadata unavailable or incomplete.
 */
export type PackageUpdateState = "update" | "updatePartial" | "outOfTfm" | "upToDate" | "unknown";

/** Display order: from most to least actionable. */
export const UPDATE_STATE_RANK: Record<PackageUpdateState, number> = {
  update: 0,
  updatePartial: 1,
  outOfTfm: 2,
  upToDate: 3,
  unknown: 4,
};

const UNRESOLVED_VERSION = "unknown";

/**
 * Pure function: no network, no disk, only the DTOs the webview already holds.
 * Tested as such, rather than buried inside a component.
 */
export function resolvePackageUpdateState(
  pkg: SolutionPackageDto,
  info: PackageUpdateInfoDto,
): PackageUpdateState {
  if (info.fetchStatus !== "Ok" || info.versions.length === 0) {
    return "unknown";
  }

  // An update only touches the projects that already carry the package: the
  // verdicts of the other projects in the solution must decide nothing here.
  const installed = pkg.installations.filter(
    (i) => i.installedVersion !== UNRESOLVED_VERSION && i.installedVersion.length > 0,
  );
  if (installed.length === 0 || installed.length !== pkg.installations.length) {
    return "unknown";
  }
  const installedPaths = new Set(installed.map((i) => i.projectPath));

  // Baseline = the lowest installed version: the project furthest behind is the
  // one that determines whether anything is left to gain.
  const baseline = [...installed.map((i) => i.installedVersion)].sort(compareVersionsDesc).pop()!;

  // Prereleases stay out of play unless the existing install already uses one —
  // the same rule as the version selector in the detail panel.
  const allowPrerelease = installed.some((i) => i.installedVersion.includes("-"));
  const newer = info.versions.filter(
    (v) => (allowPrerelease || !v.isPrerelease) && compareVersionsDesc(v.version, baseline) < 0,
  );
  if (newer.length === 0) {
    return "upToDate";
  }

  const verdictsOf = (version: PackageVersionInfoDto) =>
    version.verdictsByProject.filter((v) => installedPaths.has(v.projectPath));

  // Incomplete verdicts (unresolved TFM, project added between two requests):
  // say nothing rather than wrongly announcing "out of TFM".
  if (newer.some((v) => verdictsOf(v).length !== installedPaths.size)) {
    return "unknown";
  }
  if (newer.some((v) => verdictsOf(v).every((x) => x.verdict === "Compatible"))) {
    return "update";
  }
  if (newer.some((v) => verdictsOf(v).some((x) => x.verdict === "Compatible"))) {
    return "updatePartial";
  }
  return "outOfTfm";
}
