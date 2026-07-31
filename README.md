![Nuggy Banner](./assets/Nuggy_banner.png)

<div align="center">

**The intelligent NuGet package manager for Visual Studio Code**

_Built for modern .NET developers navigating complex, multi-format solutions_

[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](https://github.com/coresync/nuggy)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-Framework%20%7C%20Core%20%7C%206%2B-purple.svg)](https://dotnet.microsoft.com/)

</div>

---

## 🎯 Why Nuggy?

Managing NuGet packages across large .NET solutions is **painful**. You're dealing with:

- 📦 **Central Package Management (CPM)** - Some projects use it, others don't
- 🏗️ **MSBuild inheritance** - TFMs and versions scattered across `Directory.Build.props`
- 🤷 **Invisible dependencies** - No clear view of what's using what
- 🔀 **Mixed project formats** - Legacy .NET Framework alongside modern .NET 8+
- 🔄 **Migration chaos** - Transitioning from `packages.config` to `PackageReference`

**Standard tools fail** because they don't understand the **deep structure** of your solution.

**Nuggy changes that.** It's a context-aware diagnostic engine that understands your entire solution architecture, whether you're running a pure modern setup, legacy .NET Framework, or a hybrid in transition.

---

## ✨ Key Features

### 🔍 **Intelligent Solution Analysis**

- **Multi-format support**: Analyzes both classic `.sln` and modern **`.slnx`** solution formats
- **Project type detection**: Automatically identifies SDK-style vs. Legacy .NET Framework projects
- **Hybrid solution intelligence**: Detects transitional architectures mixing old and new

### 📦 **Central Package Management (CPM)**

- **Automatic CPM detection**: Finds and parses `Directory.Packages.props` files
- **Hierarchical CPM support**: Handles multiple CPM files across solution directories
- **Version conflict detection**: Identifies projects with local versions when CPM is enabled
- **Affected project mapping**: Shows which projects are governed by each CPM file

### 🏗️ **MSBuild Property Resolution**

- **Smart TFM detection**: Resolves Target Framework Monikers from `.csproj`, `Directory.Build.props`, and `Directory.Build.targets`
- **Property inheritance**: Follows MSBuild's priority chain to find effective values
- **Variable resolution**: Resolves MSBuild property references like `$(MySharedFramework)` → `net8.0`

### 🔄 **Legacy & Transitional Support**

- **`packages.config`**: Full support for legacy NuGet package format
- **Mixed-mode detection**: Identifies solutions combining `packages.config` and `PackageReference`
- **Transitional diagnostics**: Provides insights for teams migrating from .NET Framework to .NET Core/8+

### 🛠️ **Diagnostic Modes**

Nuggy analyzes your solution and categorizes it into one of three management modes:

| Mode           | Description                                                                  | Example                                               |
| -------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| **🔵 Local**   | Each project manages its own package versions independently                  | Modern solution without CPM                           |
| **🟢 Central** | All projects use Central Package Management (`Directory.Packages.props`)     | Enterprise solution with CPM enabled                  |
| **🟠 Mixed**   | Combination of Legacy projects (packages.config) + Modern SDK-style projects | Transitional solution during .NET Framework migration |

### 🎨 **NuGet.Config Resolution**

- **Hierarchical config detection**: Finds all `NuGet.Config` files from project to solution root
- **Source mapping**: Parses package sources and their configurations
- **Package source mapping**: Supports pattern-based source routing (e.g., `Microsoft.*` → NuGet.org)
- **Scope detection**: Identifies global vs. solution-scoped configurations

---

## 🚀 Getting Started

### Installation

1. Open Visual Studio Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for "Nuggy"
4. Click **Install**

### Quick Start

1. **Open your .NET solution** in VS Code
2. **Open Command Palette** (`Ctrl+Shift+P`)
3. Type: `Nuggy: Open Nuggy Panel`

Nuggy will automatically:

- ✅ Detect your solution format (`.sln` / `.slnx`)
- ✅ Identify all projects (SDK-style / Legacy)
- ✅ Analyze package management mode (Local / Central / Mixed)
- ✅ Resolve Target Framework Monikers (TFMs)
- ✅ Find NuGet configuration files
- ✅ Detect version conflicts and issues

---

## 📊 What Nuggy Analyzes

### Solution-Level Analysis

```
✓ Solution format (.sln / .slnx)
✓ Project count and types (SDK-style / Legacy)
✓ Management mode (Local / Central / Mixed)
✓ Transitional state detection
✓ NuGet.Config hierarchy
```

### Project-Level Analysis

```
✓ Project SDK type (SDK-Style / Legacy / Unknown)
✓ Target Framework Moniker (TFM) - with MSBuild property resolution
✓ Package references (PackageReference / packages.config)
✓ Local vs. central version detection
✓ Multi-targeting support
```

### Package-Level Analysis

```
✓ Central package versions (Directory.Packages.props)
✓ Local package references (per project)
✓ Legacy packages (packages.config)
✓ Version conflicts (local override when CPM enabled)
✓ Affected projects per package
```

---

## 🛣️ Roadmap

### ✅ Completed

- [x] **EPIC 1**: Semantic Diagnostic Engine & Solution Scanning
  - [x] Workspace mapping (`SLN` / `SLNX` / `Solution folders`)
  - [x] Detection of global configuration files (`Props` / `Targets`)
  - [x] Diagnosis of package management mode (`CPM` vs. `Local`)
  - [x] Calculation of Effective TFM and MSBuild property resolution
  - [x] Analysis of legacy files (`packages.config`) and mixed solutions
  - [x] NuGet configuration resolution (`NuGet.Config`)

- [x] **EPIC 2**: Decision Engine and Compatibility Analysis
  - [x] NuGet.org V3 API client with typed errors (`Offline` / `NotFound` / `RateLimited`) and TTL-based metadata cache
  - [x] Solution-wide package aggregation and per-version, per-project compatibility verdicts
  - [x] Packages view UI: consolidated list, lazy icons, progressive badge loading, filters
  - [x] Package detail panel: metadata, collapsible dependencies, per-project verdicts, prerelease toggle

- [x] **EPIC 3**: Package Write Operations
  - [x] Surgical MSBuild text editing — formatting, comments, CRLF and BOM preserved byte for byte
  - [x] Install / update / uninstall, per project or solution-wide, with native CPM semantics
  - [x] Debounced automatic `dotnet restore`, never concurrent, with its status surfaced in the UI
  - [x] Transitive blame on failure via `dotnet nuget why`
  - [x] `packages.config` projects kept read-only, with an explicit reason in the UI

- [x] **EPIC 4**: Tabs, Logs & Observability
  - [x] Packages / Logs tabs, styled with VS Code tokens and keyboard-navigable
  - [x] Bounded session journal: restore runs with full output, plus every write operation
  - [x] Failure banner navigates to the matching run in the Logs tab
  - [x] Per-project install for packages absent from a project
  - [x] Update-availability badge answering "what can I gain?", sorted most actionable first

- [x] **EPIC 5**: Interactive Search and Installation
  - [x] Free-text paginated search on nuget.org, behind a source port ready for private feeds
  - [x] Single list: installed packages only until you type, then two labelled sections
  - [x] Install a package absent from the whole solution, one project at a time
  - [x] Multi-source aggregation: parallel queries, deduplication, one failing source never sinks the rest

- [x] **Internationalization**: English, French, Spanish and German, with per-key fallback to English

### 🚧 Next

- [ ] **EPIC 6**: Enhanced CPM & Solution Consistency
  - [ ] Automatic migration to Central Package Management where applicable
  - [ ] Consolidation of versions that diverge across projects
  - [ ] `packages.config` → `PackageReference` migration

- [ ] **EPIC 7**: Dependency Graph Impact Analysis
  - [ ] Answer "you want EF 10, but you depend on Pomelo, which has no .NET 10 release yet"
  - [ ] Transitive resolution and version-constraint conflicts

- [ ] **EPIC 8**: TFM Upgrade Assistance
  - [ ] Raise project TFMs on a new .NET release, together with the packages that guarantee compatibility

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 💬 Support

- 📧 **Email**: support@coresync.dev
- 🐛 **Issues**: [GitHub Issues](https://github.com/coresync/nuggy/issues)
- 💡 **Feature Requests**: [GitHub Discussions](https://github.com/coresync/nuggy/discussions)

---

<div align="center">

**Made with ❤️ by [Coresync](https://github.com/coresync)**

_Simplifying NuGet management for .NET developers worldwide_

</div>
