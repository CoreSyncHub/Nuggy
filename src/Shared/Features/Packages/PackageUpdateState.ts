import { type SolutionPackageDto } from "../Dtos/SolutionPackagesDto";
import {
  type PackageUpdateInfoDto,
  type PackageVersionInfoDto,
} from "../Dtos/PackageUpdateInfoDto";
import { compareVersionsDesc } from "../Versions/CompareVersions";

/**
 * Ce qu'un package déjà installé apporte comme marge de progression — la
 * question utile sur une solution existante, là où « la dernière version
 * est-elle compatible ? » ne dit rien d'actionnable.
 *
 * - `update` : une version plus récente est compatible avec tous les projets
 *   qui portent le package — montable tout de suite.
 * - `updatePartial` : plus récente compatible avec une partie des projets
 *   seulement (solution à TFM hétérogènes).
 * - `outOfTfm` : des versions plus récentes existent, aucune pour les TFM en
 *   place. Information, pas anomalie : rester sur une LTS pendant qu'un
 *   écosystème publie pour la version suivante est un choix légitime.
 * - `upToDate` : rien de plus récent.
 * - `unknown` : métadonnées indisponibles ou incomplètes.
 */
export type PackageUpdateState = "update" | "updatePartial" | "outOfTfm" | "upToDate" | "unknown";

/** Ordre d'affichage : du plus actionnable au moins actionnable. */
export const UPDATE_STATE_RANK: Record<PackageUpdateState, number> = {
  update: 0,
  updatePartial: 1,
  outOfTfm: 2,
  upToDate: 3,
  unknown: 4,
};

const UNRESOLVED_VERSION = "unknown";

/**
 * Fonction pure : aucun accès réseau ni disque, uniquement les DTO déjà en
 * main côté webview. Testée à ce titre, plutôt que noyée dans un composant.
 */
export function resolvePackageUpdateState(
  pkg: SolutionPackageDto,
  info: PackageUpdateInfoDto,
): PackageUpdateState {
  if (info.fetchStatus !== "Ok" || info.versions.length === 0) {
    return "unknown";
  }

  // Une mise à jour ne touche que les projets qui portent déjà le package :
  // les verdicts des autres projets de la solution ne doivent rien décider.
  const installed = pkg.installations.filter(
    (i) => i.installedVersion !== UNRESOLVED_VERSION && i.installedVersion.length > 0,
  );
  if (installed.length === 0 || installed.length !== pkg.installations.length) {
    return "unknown";
  }
  const installedPaths = new Set(installed.map((i) => i.projectPath));

  // Référence = la plus basse des versions installées : c'est le projet le plus
  // en retard qui détermine s'il reste quelque chose à gagner.
  const baseline = [...installed.map((i) => i.installedVersion)].sort(compareVersionsDesc).pop()!;

  // Les préversions restent hors-jeu sauf si l'existant en utilise déjà une —
  // même règle que le sélecteur de versions du détail.
  const allowPrerelease = installed.some((i) => i.installedVersion.includes("-"));
  const newer = info.versions.filter(
    (v) => (allowPrerelease || !v.isPrerelease) && compareVersionsDesc(v.version, baseline) < 0,
  );
  if (newer.length === 0) {
    return "upToDate";
  }

  const verdictsOf = (version: PackageVersionInfoDto) =>
    version.verdictsByProject.filter((v) => installedPaths.has(v.projectPath));

  // Verdicts incomplets (TFM non résolu, projet apparu entre deux requêtes) :
  // ne rien affirmer plutôt que d'annoncer à tort « hors TFM ».
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
