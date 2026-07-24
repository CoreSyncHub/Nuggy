import * as path from 'path';
import { BuildConfigDetector } from '../BuildConfigDetector';
import { BuildConfigFile } from '../../../Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '../../../Domain/Build/Enums/BuildConfigFileType';

describe('BuildConfigDetector', () => {
  let detector: BuildConfigDetector;

  beforeEach(() => {
    detector = new BuildConfigDetector();
  });

  describe('buildHierarchy', () => {
    it('should establish parent-child relationships for files in nested directories', () => {
      // Create mock files at different levels
      const rootProps = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const srcProps = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src'
      );

      const libProps = new BuildConfigFile(
        '/Solution/src/lib/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src/lib'
      );

      const files = [rootProps, srcProps, libProps];

      detector.buildHierarchy(files);

      // Root should have no parent
      expect(rootProps.parent).toBeNull();
      expect(rootProps.children).toHaveLength(1);
      expect(rootProps.children[0]).toBe(srcProps);

      // Src should have root as parent
      expect(srcProps.parent).toBe(rootProps);
      expect(srcProps.children).toHaveLength(1);
      expect(srcProps.children[0]).toBe(libProps);

      // Lib should have src as parent
      expect(libProps.parent).toBe(srcProps);
      expect(libProps.children).toHaveLength(0);
    });

    it('should handle multiple file types independently', () => {
      const rootProps = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const rootTargets = new BuildConfigFile(
        '/Solution/Directory.Build.targets',
        BuildConfigFileType.DirectoryBuildTargets,
        '/Solution'
      );

      const srcProps = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src'
      );

      const files = [rootProps, rootTargets, srcProps];

      detector.buildHierarchy(files);

      // Props hierarchy
      expect(rootProps.parent).toBeNull();
      expect(rootProps.children).toHaveLength(1);
      expect(srcProps.parent).toBe(rootProps);

      // Targets should be separate (no children)
      expect(rootTargets.parent).toBeNull();
      expect(rootTargets.children).toHaveLength(0);
    });

    it('should handle files at the same level (siblings)', () => {
      const rootProps = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const src1Props = new BuildConfigFile(
        '/Solution/Project1/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/Project1'
      );

      const src2Props = new BuildConfigFile(
        '/Solution/Project2/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/Project2'
      );

      const files = [rootProps, src1Props, src2Props];

      detector.buildHierarchy(files);

      // Both siblings should have root as parent
      expect(src1Props.parent).toBe(rootProps);
      expect(src2Props.parent).toBe(rootProps);

      // Root should have both as children
      expect(rootProps.children).toHaveLength(2);
      expect(rootProps.children).toContain(src1Props);
      expect(rootProps.children).toContain(src2Props);
    });
  });

  describe('findAffectingConfigFile', () => {
    it('should find the closest config file affecting a project', () => {
      const rootProps = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const srcProps = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src'
      );

      const files = [rootProps, srcProps];
      detector.buildHierarchy(files);

      // Project in src should be affected by srcProps
      const projectPath = '/Solution/src/MyProject/MyProject.csproj';
      const projectPaths = [projectPath];

      detector.mapAffectedProjects(files, projectPaths);

      expect(srcProps.affectedProjects).toContain(projectPath);
      expect(rootProps.affectedProjects).not.toContain(projectPath);
    });

    it('should fall back to parent if no config in project directory', () => {
      const rootProps = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const files = [rootProps];

      // Project in subdirectory without its own Directory.Build.props
      const projectPath = '/Solution/src/MyProject/MyProject.csproj';
      const projectPaths = [projectPath];

      detector.mapAffectedProjects(files, projectPaths);

      // Should be affected by root
      expect(rootProps.affectedProjects).toContain(projectPath);
    });
  });

  describe('getRootFiles', () => {
    it('should return only files without parents', () => {
      const rootProps = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const srcProps = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src'
      );

      const files = [rootProps, srcProps];
      detector.buildHierarchy(files);

      const rootFiles = detector.getRootFiles(files);

      expect(rootFiles).toHaveLength(1);
      expect(rootFiles[0]).toBe(rootProps);
    });
  });

  describe('isCpmEnabled', () => {
    it('should return true if Directory.Packages.props exists', () => {
      const cpmFile = new BuildConfigFile(
        '/Solution/Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        '/Solution'
      );

      expect(detector.isCpmEnabled([cpmFile])).toBe(true);
    });

    it('should return false if no CPM file exists', () => {
      const propsFile = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      expect(detector.isCpmEnabled([propsFile])).toBe(false);
    });
  });

  describe('getCpmFile', () => {
    it('should return the CPM file if it exists', () => {
      const cpmFile = new BuildConfigFile(
        '/Solution/Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        '/Solution'
      );

      const propsFile = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const result = detector.getCpmFile([cpmFile, propsFile]);

      expect(result).toBe(cpmFile);
    });

    it('should return null if no CPM file exists', () => {
      const propsFile = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const result = detector.getCpmFile([propsFile]);

      expect(result).toBeNull();
    });
  });

  describe('mapAffectedProjects', () => {
    it('should map projects to their affecting Directory.Build.props files', async () => {
      const rootProps = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const nestedProps = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src'
      );

      const configFiles = [rootProps, nestedProps];

      const projectPaths = [
        '/Solution/Project1/Project1.csproj',
        '/Solution/src/Project2/Project2.csproj',
      ];

      await detector.mapAffectedProjects(configFiles, projectPaths);

      // Project1 should be affected by root props
      expect(rootProps.affectedProjects).toContain('/Solution/Project1/Project1.csproj');

      // Project2 should be affected by nested props (closer)
      expect(nestedProps.affectedProjects).toContain(
        '/Solution/src/Project2/Project2.csproj'
      );
    });

    it('should map projects to Directory.Build.targets files', async () => {
      const targetsFile = new BuildConfigFile(
        '/Solution/Directory.Build.targets',
        BuildConfigFileType.DirectoryBuildTargets,
        '/Solution'
      );

      const configFiles = [targetsFile];

      const projectPaths = ['/Solution/Project/Project.csproj'];

      await detector.mapAffectedProjects(configFiles, projectPaths);

      expect(targetsFile.affectedProjects).toContain('/Solution/Project/Project.csproj');
    });

    it('should map projects to Directory.Packages.props files', async () => {
      const packagesFile = new BuildConfigFile(
        '/Solution/Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        '/Solution'
      );

      const configFiles = [packagesFile];

      const projectPaths = ['/Solution/Project/Project.csproj'];

      await detector.mapAffectedProjects(configFiles, projectPaths);

      expect(packagesFile.affectedProjects).toContain('/Solution/Project/Project.csproj');
    });

    it('should handle projects with no affecting config files', async () => {
      const propsFile = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src'
      );

      const configFiles = [propsFile];

      // Project outside the src directory
      const projectPaths = ['/OtherSolution/Project/Project.csproj'];

      await detector.mapAffectedProjects(configFiles, projectPaths);

      // No projects should be affected
      expect(propsFile.affectedProjects).toHaveLength(0);
    });
  });
});
