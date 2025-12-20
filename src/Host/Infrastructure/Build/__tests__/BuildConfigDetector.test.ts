import * as path from 'path';
import { BuildConfigDetector } from '../BuildConfigDetector';
import { BuildConfigFile } from '../../../Domain/Build/Entities/BuildConfigFile';
import { BuildConfigFileType } from '../../../Domain/Build/Enums/BuildConfigFileType';

describe('BuildConfigDetector', () => {
  describe('buildHierarchy', () => {
    it('should establish parent-child relationships for files in nested directories', () => {
      // Create mock files at different levels
      const rootProps = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const srcProps = new BuildConfigFile(
        'C:\\Solution\\src\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution\\src'
      );

      const libProps = new BuildConfigFile(
        'C:\\Solution\\src\\lib\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution\\src\\lib'
      );

      const files = [rootProps, srcProps, libProps];

      BuildConfigDetector.buildHierarchy(files);

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
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const rootTargets = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.targets',
        BuildConfigFileType.DirectoryBuildTargets,
        'C:\\Solution'
      );

      const srcProps = new BuildConfigFile(
        'C:\\Solution\\src\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution\\src'
      );

      const files = [rootProps, rootTargets, srcProps];

      BuildConfigDetector.buildHierarchy(files);

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
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const src1Props = new BuildConfigFile(
        'C:\\Solution\\Project1\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution\\Project1'
      );

      const src2Props = new BuildConfigFile(
        'C:\\Solution\\Project2\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution\\Project2'
      );

      const files = [rootProps, src1Props, src2Props];

      BuildConfigDetector.buildHierarchy(files);

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
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const srcProps = new BuildConfigFile(
        'C:\\Solution\\src\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution\\src'
      );

      const files = [rootProps, srcProps];
      BuildConfigDetector.buildHierarchy(files);

      // Project in src should be affected by srcProps
      const projectPath = 'C:\\Solution\\src\\MyProject\\MyProject.csproj';
      const projectPaths = [projectPath];

      BuildConfigDetector.mapAffectedProjects(files, projectPaths);

      expect(srcProps.affectedProjects).toContain(projectPath);
      expect(rootProps.affectedProjects).not.toContain(projectPath);
    });

    it('should fall back to parent if no config in project directory', () => {
      const rootProps = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const files = [rootProps];

      // Project in subdirectory without its own Directory.Build.props
      const projectPath = 'C:\\Solution\\src\\MyProject\\MyProject.csproj';
      const projectPaths = [projectPath];

      BuildConfigDetector.mapAffectedProjects(files, projectPaths);

      // Should be affected by root
      expect(rootProps.affectedProjects).toContain(projectPath);
    });
  });

  describe('getRootFiles', () => {
    it('should return only files without parents', () => {
      const rootProps = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const srcProps = new BuildConfigFile(
        'C:\\Solution\\src\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution\\src'
      );

      const files = [rootProps, srcProps];
      BuildConfigDetector.buildHierarchy(files);

      const rootFiles = BuildConfigDetector.getRootFiles(files);

      expect(rootFiles).toHaveLength(1);
      expect(rootFiles[0]).toBe(rootProps);
    });
  });

  describe('isCpmEnabled', () => {
    it('should return true if Directory.Packages.props exists', () => {
      const cpmFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      expect(BuildConfigDetector.isCpmEnabled([cpmFile])).toBe(true);
    });

    it('should return false if no CPM file exists', () => {
      const propsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      expect(BuildConfigDetector.isCpmEnabled([propsFile])).toBe(false);
    });
  });

  describe('getCpmFile', () => {
    it('should return the CPM file if it exists', () => {
      const cpmFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        'C:\\Solution'
      );

      const propsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const result = BuildConfigDetector.getCpmFile([cpmFile, propsFile]);

      expect(result).toBe(cpmFile);
    });

    it('should return null if no CPM file exists', () => {
      const propsFile = new BuildConfigFile(
        'C:\\Solution\\Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        'C:\\Solution'
      );

      const result = BuildConfigDetector.getCpmFile([propsFile]);

      expect(result).toBeNull();
    });
  });
});
