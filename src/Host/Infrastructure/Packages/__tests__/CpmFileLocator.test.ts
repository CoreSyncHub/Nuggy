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
  it("keeps the CPM file closest to the project, not the first one in the list", () => {
    // Deliberately unfavourable discovery order: the root comes first.
    const files = [cpm("/repo"), cpm("/repo/src")];
    expect(findGoverningCpmFile(PROJECT, files)).toBe("/repo/src/Directory.Packages.props");
  });

  it("is insensitive to the order of the list", () => {
    const files = [cpm("/repo/src"), cpm("/repo")];
    expect(findGoverningCpmFile(PROJECT, files)).toBe("/repo/src/Directory.Packages.props");
  });

  it("accepts a file sitting in the project's own directory", () => {
    const files = [cpm("/repo"), cpm("/repo/src/Api")];
    expect(findGoverningCpmFile(PROJECT, files)).toBe("/repo/src/Api/Directory.Packages.props");
  });

  it("ignores a CPM file that is not an ancestor of the project", () => {
    // The case that motivates the fix: a CPM file from another domain does not govern this project.
    const files = [cpm("/repo/tests")];
    expect(findGoverningCpmFile(PROJECT, files)).toBeUndefined();
  });

  it("is not fooled by a directory name prefix", () => {
    // "/repo/src-legacy" starts with "/repo/src" without being an ancestor of it.
    const files = [cpm("/repo/src-legacy")];
    expect(findGoverningCpmFile(PROJECT, files)).toBeUndefined();
  });

  it("ignores configuration files that are not Directory.Packages.props", () => {
    const files = [props("/repo/src"), cpm("/repo")];
    expect(findGoverningCpmFile(PROJECT, files)).toBe("/repo/Directory.Packages.props");
  });

  it("returns undefined when no configuration file is supplied", () => {
    expect(findGoverningCpmFile(PROJECT, [])).toBeUndefined();
  });

  it("handles a CPM file at the filesystem root", () => {
    expect(findGoverningCpmFile(PROJECT, [cpm("/")])).toBe("/Directory.Packages.props");
  });
});
