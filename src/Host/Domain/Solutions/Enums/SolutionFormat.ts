import { ObjectEnumType } from '@/Shared/Types/ObjetEnumType';

export const SolutionFormat = {
  /** Classic .sln format with GUIDs */
  Sln: 'sln',
  /** New XML-based .slnx format */
  Slnx: 'slnx',
} as const;

export type SolutionFormat = ObjectEnumType<typeof SolutionFormat>;
