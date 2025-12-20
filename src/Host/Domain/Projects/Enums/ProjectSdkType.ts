import { ObjectEnumType } from '@/Shared/Types/ObjetEnumType';

/**
 * Represents the SDK type of a .NET project
 */
export const ProjectSdkType = {
  /**
   * Modern SDK-style project (typically .NET Core, .NET 5+)
   * Identified by the presence of the Sdk attribute in the Project element
   * Example: <Project Sdk="Microsoft.NET.Sdk">
   */
  SdkStyle: 'SDK-Style',

  /**
   * Legacy project format (.NET Framework, pre-.NET Core)
   * Uses packages.config and verbose .csproj format
   * No Sdk attribute in Project element
   */
  Legacy: 'Legacy',

  /**
   * Unknown or unrecognized project format
   */
  Unknown: 'Unknown',
} as const;

export type ProjectSdkType = ObjectEnumType<typeof ProjectSdkType>;
