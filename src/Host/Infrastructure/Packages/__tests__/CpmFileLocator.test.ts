jest.mock("path", () => jest.requireActual("path").posix);

import { findGoverningCpmFile } from "../CpmFileLocator";
import { BuildConfigFile } from "../../../Domain/Build/Entities/BuildConfigFile";
import { BuildConfigFileType } from "../../../Domain/Build/Enums/BuildConfigFileType";

function cpm(directory: string): BuildConfigFile {
  const filePath = `${directory === "/" ? "" : directory}/Directory.Packages.props`;
  return new BuildConfigFile(filePath, BuildConfigFileType.DirectoryPackagesProps, directory);
}

function props(directory: string): BuildConfigFile {
  const filePath = `${directory}/Directory.Build.props`;
  return new BuildConfigFile(filePath, BuildConfigFileType.DirectoryBuildProps, directory);
}

const PROJECT = "/repo/src/Api/Api.csproj";

describe("findGoverningCpmFile", () => {
  it("retient le fichier CPM le plus proche du projet, pas le premier de la liste", () => {
    // Ordre de découverte volontairement défavorable : la racine vient en premier.
    const files = [cpm("/repo"), cpm("/repo/src")];
    expect(findGoverningCpmFile(PROJECT, files)).toBe("/repo/src/Directory.Packages.props");
  });

  it("est insensible à l'ordre de la liste", () => {
    const files = [cpm("/repo/src"), cpm("/repo")];
    expect(findGoverningCpmFile(PROJECT, files)).toBe("/repo/src/Directory.Packages.props");
  });

  it("accepte un fichier situé dans le répertoire même du projet", () => {
    const files = [cpm("/repo"), cpm("/repo/src/Api")];
    expect(findGoverningCpmFile(PROJECT, files)).toBe("/repo/src/Api/Directory.Packages.props");
  });

  it("ignore un fichier CPM qui n'est pas un ancêtre du projet", () => {
    // Cas qui motive le correctif : un CPM d'un autre domaine ne gouverne pas ce projet.
    const files = [cpm("/repo/tests")];
    expect(findGoverningCpmFile(PROJECT, files)).toBeUndefined();
  });

  it("ne se laisse pas piéger par un préfixe de nom de répertoire", () => {
    // « /repo/src-legacy » commence par « /repo/src » sans en être un ancêtre.
    const files = [cpm("/repo/src-legacy")];
    expect(findGoverningCpmFile(PROJECT, files)).toBeUndefined();
  });

  it("ignore les fichiers de configuration qui ne sont pas des Directory.Packages.props", () => {
    const files = [props("/repo/src"), cpm("/repo")];
    expect(findGoverningCpmFile(PROJECT, files)).toBe("/repo/Directory.Packages.props");
  });

  it("rend undefined quand aucun fichier de configuration n'est fourni", () => {
    expect(findGoverningCpmFile(PROJECT, [])).toBeUndefined();
  });

  it("gère un fichier CPM à la racine du système de fichiers", () => {
    expect(findGoverningCpmFile(PROJECT, [cpm("/")])).toBe("/Directory.Packages.props");
  });
});
