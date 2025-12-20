import { PackageDiagnosticSeverity } from '../Enums/PackageDiagnosticSeverity';

/**
 * Represents a diagnostic message about package management
 */
export class PackageDiagnostic {
  constructor(
    public readonly severity: PackageDiagnosticSeverity,
    public readonly message: string,
    public readonly packageName: string,
    public readonly projectPath?: string,
    public readonly filePath?: string
  ) {}

  /**
   * Creates a warning diagnostic
   */
  public static warning(
    message: string,
    packageName: string,
    projectPath?: string,
    filePath?: string
  ): PackageDiagnostic {
    return new PackageDiagnostic(
      PackageDiagnosticSeverity.Warning,
      message,
      packageName,
      projectPath,
      filePath
    );
  }

  /**
   * Creates an error diagnostic
   */
  public static error(
    message: string,
    packageName: string,
    projectPath?: string,
    filePath?: string
  ): PackageDiagnostic {
    return new PackageDiagnostic(
      PackageDiagnosticSeverity.Error,
      message,
      packageName,
      projectPath,
      filePath
    );
  }

  /**
   * Creates an info diagnostic
   */
  public static info(
    message: string,
    packageName: string,
    projectPath?: string,
    filePath?: string
  ): PackageDiagnostic {
    return new PackageDiagnostic(
      PackageDiagnosticSeverity.Info,
      message,
      packageName,
      projectPath,
      filePath
    );
  }
}
