import { ObjectEnumType } from '@/Shared/Types/ObjetEnumType';

export const ProjectType = {
  ASPIRE: 'aspire',
  CONSOLE: 'console',
  LIBRARY: 'library',
  TEST: 'test',
  WEB: 'web',
};

export type ProjectType = ObjectEnumType<typeof ProjectType>;
