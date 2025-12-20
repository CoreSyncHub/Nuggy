import { ObjectEnumType } from '@/Shared/Types/ObjetEnumType';

/**
 * Represents the type of project
 */
export const ProjectType = {
  /**
   * Aspire AppHost application or Service Default application
   */
  ASPIRE: 'aspire',
  /**
   * Console application (executable)
   */
  CONSOLE: 'console',
  /**
   * Class library project
   */
  LIBRARY: 'library',
  /**
   * Test project
   */
  TEST: 'test',
  /**
   * Web application project
   */
  WEB: 'web',
};

export type ProjectType = ObjectEnumType<typeof ProjectType>;
