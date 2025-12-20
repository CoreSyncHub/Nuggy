import { ObjectEnumType } from '@/Shared/Types/ObjetEnumType';

/**
 * Type of package source
 */
export const PackageSourceType = {
  /** Package managed via Central Package Management (Directory.Packages.props) */
  CPM: 'CPM',
  /** Package managed locally in project file with version */
  Local: 'Local',
  /** Package managed via legacy packages.config file */
  Legacy: 'Legacy',
} as const;

export type PackageSourceType = ObjectEnumType<typeof PackageSourceType>;
