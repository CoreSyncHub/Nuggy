# Contributing to Nuggy

Thank you for your interest in contributing to **Nuggy**! 🎉

We welcome contributions from the community, whether it's bug reports, feature requests, documentation improvements, or code contributions.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Features](#suggesting-features)
  - [Contributing Code](#contributing-code)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)

---

## 📜 Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please be respectful, inclusive, and professional in all interactions.

**Key principles:**

- Be respectful and welcoming
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards other community members

---

## 🤝 How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/coresync/nuggy/issues) to avoid duplicates.

**When submitting a bug report, include:**

1. **Clear title** - Concise description of the issue
2. **Environment details**:
   - Nuggy version
   - VS Code version
   - Operating system
   - .NET SDK version(s)
3. **Steps to reproduce** - Detailed steps to reproduce the behavior
4. **Expected behavior** - What you expected to happen
5. **Actual behavior** - What actually happened
6. **Sample solution** - If possible, provide a minimal reproducible example
7. **Screenshots/Logs** - Any relevant screenshots or error logs

**Example:**

```markdown
**Bug**: CPM detection fails for nested Directory.Packages.props

**Environment**:

- Nuggy: v0.0.1
- VS Code: 1.85.0
- OS: Windows 11
- .NET SDK: 8.0.100

**Steps to reproduce**:

1. Create a solution with nested folders
2. Add Directory.Packages.props in root and subfolder
3. Run Nuggy analysis

**Expected**: Should detect both CPM files
**Actual**: Only detects root CPM file

**Sample solution**: [link to GitHub repo]
```

---

### Suggesting Features

We love hearing your ideas! Before suggesting a feature:

1. Check if it's already in the [Roadmap](README.md#-roadmap)
2. Search [existing discussions](https://github.com/coresync/nuggy/discussions)
3. Consider if it aligns with Nuggy's core mission

**When suggesting a feature, include:**

- **Clear use case** - What problem does this solve?
- **Expected behavior** - How should it work?
- **Alternative solutions** - Any alternatives you've considered?
- **Additional context** - Screenshots, mockups, or examples

---

### Contributing Code

We welcome code contributions! Here's how to get started:

1. **Fork the repository**
2. **Create a feature branch** from `main`
3. **Make your changes** following our coding standards
4. **Add tests** for new functionality
5. **Update documentation** if needed
6. **Submit a pull request**

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **VS Code**: Latest stable version
- **Git**: Latest version

### Initial Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/CoreSyncHub/Nuggy.git
cd Nuggy

# 2. Install dependencies
npm install

# 3. Build the project
npm run build

# 4. Run tests
npm test

# 5. Start development mode
npm run watch
```

### Running Nuggy in Development

1. **Open the project in VS Code**
2. **Press F5** to launch the Extension Development Host
3. **Test your changes** in the development instance

---

## 📁 Project Structure

Nuggy follows **Clean Architecture** principles with clear separation of concerns:

```
src/
├── Host/                          # Infrastructure & Entry Points
│   ├── Application/               # Application Layer (CQRS Handlers)
│   │   └── Handlers/
│   │       ├── Packages/          # Package management handlers
│   │       ├── Projects/          # Project analysis handlers
│   │       └── Build/             # Build configuration handlers
│   ├── Domain/                    # Domain Layer (Business Logic)
│   │   ├── Packages/
│   │   │   ├── Entities/          # PackageVersion, PackageReference, etc.
│   │   │   ├── ValueObjects/      # PackageIdentity
│   │   │   └── Enums/             # PackageManagementMode, etc.
│   │   ├── Projects/
│   │   │   └── Enums/             # ProjectSdkType
│   │   └── Build/
│   │       └── Entities/          # BuildConfigFile
│   ├── Infrastructure/            # Infrastructure Layer (I/O, Parsing)
│   │   ├── Packages/              # Package parsers (CPM, packages.config)
│   │   ├── Projects/              # Project parsers (csproj, TFM resolution)
│   │   └── Solution/              # Solution parsers (.sln, .slnx)
│   └── Presentation /             # Presentation Layer (VS Code Extension)
│       ├── WebviewProvider.ts     # Webview provider
│       ├── WebMediator.ts         # Extension host messaging mediator
│       ├── WebviewHtml.ts         # HTM Template of the webview
│       └── Program.ts             # VS Code extension entry point
│
├── Shared/                        # Shared across all layers
│   ├── Abstractions/              # Interfaces (IQueryHandler, etc.)
│   ├── Features/                  # DTOs, Queries
│   ├── Infrastructure/            # Messaging (CQRS infrastructure)
│   └── Types/                     # Common types
│
├── Tests/                         # Integration & Acceptance Test suites
│   ├── Acceptances/               # Acceptance tests
│   │   └── __tests__/             # Test files
│   ├── Fixtures/                  # .NET test solutions
│   │   ├── Enterprise/            # CPM solution
│   │   ├── Legacy/                # Legacy solution
│   │   ├── Hybrid/                # Mixed solution
│   │   └── Modern/                # Modern solution
│   └── Helpers/                   # Test utilities
│
└── Web/                           # VS Code Extension Webview
    ├── Core/                      # Core webview logic
    ├── Features/                  # UI features
    ├── I18n/                      # Internationalization
    ├── Shared/                    # Shared webview components
    ├── App.ts                     # Main webview entry point
    └── Main.ts                    # VS Code extension entry point
```

### Key Concepts

- **CQRS Pattern**: Queries are handled by `IQueryHandler` implementations
- **Clean Architecture**: Domain logic is independent of infrastructure
- **Dependency Injection**: Using `tsyringe` for IoC
- **Immutability**: DTOs and value objects are immutable

---

## 💻 Coding Standards

### TypeScript Guidelines

**File Naming**:

- PascalCase everywhere (e.g., `PackageVersionParser.ts`)
- camelCase for non code files (e.g., `fr.json`)

**Code Style**:

```typescript
// ✅ Good
export class PackageVersionParser {
  public static parse(filePath: string): PackageVersion[] {
    // Implementation
  }
}

// ❌ Bad
export class package_version_parser {
  static Parse(filePath) {
    // Implementation
  }
}
```

**Naming Conventions**:

- Classes: `PascalCase`
- Methods: `camelCase`
- Constants: `UPPER_SNAKE_CASE` or `PascalCase` for enums
- Private members: prefix with `_` (optional, but use `private` keyword)

**Comments**:

```typescript
/**
 * Parses a Directory.Packages.props file and extracts PackageVersion entries
 * @param filePath Absolute path to the file
 * @returns Array of PackageVersion entities
 */
public static parse(filePath: string): PackageVersion[] {
  // Implementation
}
```

### Architecture Guidelines

**Domain Layer**:

- No dependencies on infrastructure
- Pure business logic only
- Entities should be rich, not anemic

**Application Layer**:

- Handlers orchestrate domain logic
- No business logic in handlers
- Return DTOs, not domain entities

**Infrastructure Layer**:

- All I/O operations (file system, XML parsing)
- Concrete implementations of abstractions
- External dependencies

**Presentation Layer**:

- VS Code extension code

---

## 🧪 Testing Guidelines

### Test Structure

Nuggy uses **Jest** for testing with a focus on **unit tests** for Domain, Infrastructure, and Application layers, and **acceptance tests** for end-to-end scenarios.

**Test File Naming**:

- Acceptance tests: `*.acceptance.test.ts`
- Unit tests: `*.test.ts`

**Test Organization**:

```typescript
describe('Acceptance: Feature Name', () => {
  // Setup
  beforeAll(async () => {
    // Initialize handlers
  });

  beforeEach(() => {
    // Reset state if needed
  });

  // Test cases
  test('should validate specific behavior', () => {
    // Arrange
    const expected = 'value';

    // Act
    const actual = performAction();

    // Assert
    expect(actual).toBe(expected);
  });
});
```

### Writing Acceptance Tests

**Key principles**:

1. **Test real scenarios** - Use actual solution fixtures
2. **Be specific** - Test exact values, not just "greater than 0"
3. **Be comprehensive** - Cover all aspects of the feature
4. **Be maintainable** - Clear test names and structure

**Example**:

```typescript
test('CPM Detection', () => {
  // Should detect CPM file
  expect(result.isCpmEnabled).toBe(true);
  expect(result.cpmFilePath).toContain('Directory.Packages.props');

  // Should extract exact package versions
  const serilog = result.packageVersions.find((p) => p.name === 'Serilog');
  expect(serilog).toBeDefined();
  expect(serilog?.version).toBe('4.0.0');

  // Should map to affected projects
  expect(serilog?.affectedProjects.length).toBeGreaterThan(0);
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- HybridSolution.acceptance.test.ts

# Run tests in watch mode
npm test -- --watch

# Run with coverage
npm test -- --coverage
```

### Test Fixtures

When adding new test scenarios:

1. **Create a fixture directory** in `src/Tests/Fixtures/`
2. **Add realistic solution structure** (.sln, .csproj, configs)
3. **Document the scenario** in the test file comments
4. **Create comprehensive test cases**

---

## 📝 Commit Guidelines

We follow **Conventional Commits** for clear and semantic commit history.

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring (no functional change)
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (dependencies, build config)

**Scopes examples** (optional):

- `cpm`: Central Package Management
- `tfm`: Target Framework Moniker resolution
- `parser`: XML/config parsing
- `diagnostic`: Diagnostic engine
- `ui`: User interface

**Examples**:

```bash
feat(cpm): add hierarchical Directory.Packages.props support

Implements detection and parsing of nested CPM files.
Follows MSBuild's priority chain for version resolution.

Closes #123

---

fix(tfm): resolve MSBuild property references in TFM

Legacy projects using $(MyFramework) in TargetFramework
were not being resolved correctly.

Fixes #456

---

docs: update README with CPM examples

---

test: add acceptance tests for hybrid solutions
```

---

## 🔄 Pull Request Process

### Before Submitting

1. ✅ **Run tests** - Ensure all tests pass (`npm test`)
2. ✅ **Run linter** - Fix any linting issues (`npm run lint`)
3. ✅ **Build successfully** - No compilation errors (`npm run build`)
4. ✅ **Update docs** - If you changed behavior, update README/docs
5. ✅ **Add tests** - New features require tests

### PR Template

When opening a PR, include:

```markdown
## Description

Brief description of the changes

## Motivation and Context

Why is this change needed? What problem does it solve?

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update

## How Has This Been Tested?

- [ ] Unit tests
- [ ] Acceptance tests
- [ ] Manual testing in Extension Development Host

## Screenshots (if applicable)

## Checklist

- [ ] My code follows the project's coding standards
- [ ] I have updated the documentation
- [ ] I have added tests that prove my fix/feature works
- [ ] All tests pass locally
- [ ] My commits follow the Conventional Commits standard
```

### Review Process

1. **Automated checks** - CI must pass (build, tests, linting)
2. **Code review** - At least one maintainer approval required
3. **Testing** - Reviewer tests the changes manually if needed
4. **Merge** - Squash and merge into `main`

---

## 🚀 Release Process

Releases are managed by maintainers following semantic versioning:

- **Major** (1.0.0): Breaking changes
- **Minor** (0.1.0): New features (backward compatible)
- **Patch** (0.0.1): Bug fixes

**Release checklist**:

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create Git tag
4. Build and package extension
5. Publish to VS Code Marketplace
6. Create GitHub release

---

## 🆘 Getting Help

If you need help:

- 💬 **Discussions**: [GitHub Discussions](https://github.com/coresync/nuggy/discussions)
- 🐛 **Issues**: [GitHub Issues](https://github.com/coresync/nuggy/issues)
- 📧 **Email**: support@coresync.dev

---

## 🙏 Recognition

Contributors will be recognized in:

- Release notes
- Contributors section in README
- Project documentation

Thank you for contributing to Nuggy! 🎉

---

<div align="center">

**Built with ❤️ by the Nuggy community**

</div>
