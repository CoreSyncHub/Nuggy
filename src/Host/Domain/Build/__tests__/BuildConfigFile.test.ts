import { BuildConfigFile } from '../Entities/BuildConfigFile';
import { BuildConfigFileType } from '../Enums/BuildConfigFileType';

describe('BuildConfigFile', () => {
  describe('addChild', () => {
    it('should add a child configuration file', () => {
      const parent = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const child = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src',
        parent
      );

      parent.addChild(child);

      expect(parent.children).toHaveLength(1);
      expect(parent.children[0]).toBe(child);
    });
  });

  describe('addAffectedProject', () => {
    it('should add a project path to affected projects', () => {
      const configFile = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      configFile.addAffectedProject('/Solution/Project1/Project1.csproj');

      expect(configFile.affectedProjects).toContain(
        '/Solution/Project1/Project1.csproj'
      );
    });

    it('should not add duplicate project paths', () => {
      const configFile = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const projectPath = '/Solution/Project1/Project1.csproj';
      configFile.addAffectedProject(projectPath);
      configFile.addAffectedProject(projectPath);

      expect(configFile.affectedProjects).toHaveLength(1);
    });
  });

  describe('setProperty', () => {
    it('should set a property value', () => {
      const configFile = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      configFile.setProperty('TargetFramework', 'net8.0');

      expect(configFile.properties.get('TargetFramework')).toBe('net8.0');
    });

    it('should override existing property values', () => {
      const configFile = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      configFile.setProperty('TargetFramework', 'net7.0');
      configFile.setProperty('TargetFramework', 'net8.0');

      expect(configFile.properties.get('TargetFramework')).toBe('net8.0');
    });
  });

  describe('getAllProperties', () => {
    it('should return own properties for files without parents', () => {
      const configFile = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      configFile.setProperty('TargetFramework', 'net8.0');
      configFile.setProperty('Nullable', 'enable');

      const allProps = configFile.getAllProperties();

      expect(allProps.get('TargetFramework')).toBe('net8.0');
      expect(allProps.get('Nullable')).toBe('enable');
      expect(allProps.size).toBe(2);
    });

    it('should merge parent and child properties', () => {
      const parent = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const child = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src',
        parent
      );

      parent.setProperty('TargetFramework', 'net8.0');
      parent.setProperty('Nullable', 'enable');
      child.setProperty('LangVersion', 'latest');

      const allProps = child.getAllProperties();

      expect(allProps.get('TargetFramework')).toBe('net8.0');
      expect(allProps.get('Nullable')).toBe('enable');
      expect(allProps.get('LangVersion')).toBe('latest');
      expect(allProps.size).toBe(3);
    });

    it('should override parent properties with child values', () => {
      const parent = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const child = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src',
        parent
      );

      parent.setProperty('TargetFramework', 'net7.0');
      child.setProperty('TargetFramework', 'net8.0');

      const allProps = child.getAllProperties();

      // Child value should override parent
      expect(allProps.get('TargetFramework')).toBe('net8.0');
    });

    it('should handle multi-level hierarchies', () => {
      const root = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const middle = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src',
        root
      );

      const leaf = new BuildConfigFile(
        '/Solution/src/lib/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src/lib',
        middle
      );

      root.setProperty('Prop1', 'root');
      middle.setProperty('Prop2', 'middle');
      leaf.setProperty('Prop3', 'leaf');

      const allProps = leaf.getAllProperties();

      expect(allProps.get('Prop1')).toBe('root');
      expect(allProps.get('Prop2')).toBe('middle');
      expect(allProps.get('Prop3')).toBe('leaf');
      expect(allProps.size).toBe(3);
    });
  });

  describe('getDepth', () => {
    it('should return 0 for root files', () => {
      const root = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      expect(root.getDepth()).toBe(0);
    });

    it('should return correct depth for nested files', () => {
      const root = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const level1 = new BuildConfigFile(
        '/Solution/src/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src',
        root
      );

      const level2 = new BuildConfigFile(
        '/Solution/src/lib/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution/src/lib',
        level1
      );

      expect(level1.getDepth()).toBe(1);
      expect(level2.getDepth()).toBe(2);
    });
  });

  describe('isCentralPackageManagement', () => {
    it('should return true for Directory.Packages.props', () => {
      const cpmFile = new BuildConfigFile(
        '/Solution/Directory.Packages.props',
        BuildConfigFileType.DirectoryPackagesProps,
        '/Solution'
      );

      expect(cpmFile.isCentralPackageManagement()).toBe(true);
    });

    it('should return false for other types', () => {
      const propsFile = new BuildConfigFile(
        '/Solution/Directory.Build.props',
        BuildConfigFileType.DirectoryBuildProps,
        '/Solution'
      );

      const targetsFile = new BuildConfigFile(
        '/Solution/Directory.Build.targets',
        BuildConfigFileType.DirectoryBuildTargets,
        '/Solution'
      );

      expect(propsFile.isCentralPackageManagement()).toBe(false);
      expect(targetsFile.isCentralPackageManagement()).toBe(false);
    });
  });
});
