# Languages Craidd-Studio does NOT support yet — and why

**Roadmap track:** Later language expansion, unassigned. See the [current roadmap](../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Design decisions, not roadblocks. Each section says *what we'd do*,
*why we're not doing it yet*, and *what unblocks it*. Nothing here is
"never." Everything here is "not this phase."

---

## Java

### The status

Java is not supported in Phase 2. It will not be supported in Phase 3.
It becomes viable when the IDE has a **language profile system** — a
per-language interpreter that changes how the IDE reads a project's
folder structure.

### Why Java is different

Every language Craidd currently supports (Rust, TypeScript, JavaScript,
Python, C++, C#, Config) is a **file-tree language**:

- A folder is a project because there's a `.craidd` file in it.
- The tree is a recursive walk of the folder.
- Files are filtered by extension.
- Structure is what it looks like on disk.

Java is a **package-tree language**:

- Folders are not the semantic unit. **Packages** are.
- `src/com/example/app/App.java` is not "the folder `com/example/app/`
  containing a file." It is **package `com.example.app` containing
  class `App`**.
- The filesystem *is* the package structure. The compiler enforces this.
- A `.craidd` inside `com/example/app/` would be semantically wrong —
  it would imply a project boundary where the language has a package
  boundary.

### What Java support would look like (when it arrives)

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a record.*
