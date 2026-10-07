# Git workspaces: worktree architecture and project history

**Roadmap track:** Later, unassigned Git workspaces proposal; local stages 0–8 are not global phases. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

| | |
|---|---|
| **Author** | OpenAI GPT-5.6 Sol |
| **Date** | 2026-10-07 |
| **Status** | Design proposal |
| **Feature** | Git Workspaces |
| **Scope** | Worktrees, workspace isolation, dirty state, history, recovery, agents, and remote editing |
| **Source** | Design discussion with skira24; informed by Craidd Studio's existing multi-window and Git-oriented project model |

---

## 1. Summary

Craidd Studio should treat a Git repository, branch, worktree, IDE workspace,
and IDE window as related but distinct concepts.

The core model is:

+++text
Repository = shared project history
Branch     = development timeline
Worktree   = independently editable filesystem state
Workspace  = Craidd representation of an editable project state
Window     = UI attached to a workspace
+++

This model allows Craidd Studio to support multiple simultaneously active
states of the same project without requiring those states to share one
working directory.

A single repository may therefore have:

- the user's normal development workspace;
- another workspace for an experimental branch;
- one or more agent workspaces;
- a remote editing workspace;
- debugging or profiling workspaces;
- temporarily retained dirty workspaces.

Each Git-backed workspace may be represented by a Git worktree.

Git worktrees should **not** be treated as historical versions.

Git commits and objects represent historical state.

Worktrees represent **live editable state**.

This distinction is fundamental to the design.

---

## 2. Motivation

Traditional IDE project handling commonly assumes:

+++text
Project
  └── Working Directory
       └── Current Branch
+++

That model becomes limiting when multiple actors or windows need to work on
the same repository simultaneously.

Craidd Studio is intended to support workflows where a user may have many
windows open at once and where future tooling may include:

- local human editing;
- parallel feature development;
- autonomous or semi-autonomous coding agents;
- debugging sessions;
- remote editing;
- background analysis;
- historical inspection;
- crash/session recovery.

Git already contains a mechanism designed for multiple working directories
belonging to one repository: `git worktree`.

Craidd should use that mechanism rather than inventing a second filesystem
isolation system for Git projects.

---

## 3. Design principles

### 3.1 Repository is not workspace

A repository represents shared version history.

It does not represent one particular editable filesystem.

Craidd MUST NOT assume:

+++text
Repository -> one checkout
+++

Instead:

+++text
Repository
  ├── Workspace A
  ├── Workspace B
  └── Workspace C
+++

For Git-backed projects these workspaces may map to:

+++text
Repository
  ├── Worktree A
  ├── Worktree B
  └── Worktree C
+++

---

### 3.2 Dirty state belongs to a workspace

Git dirty state is associated with a working tree.

Craidd MUST NOT model Git status as a single global property of a project.

Incorrect:

+++text
Project
  └── GitStatus
+++

Correct:

+++text
Project
  ├── Workspace A
  │    └── GitStatus
  │
  ├── Workspace B
  │    └── GitStatus
  │
  └── Workspace C
       └── GitStatus
+++

Each workspace may independently contain:

- modified files;
- deleted files;
- added files;
- untracked files;
- staged files;
- unresolved conflicts;
- a checked-out branch;
- a detached HEAD;
- editor buffers not yet written to disk.

---

### 3.3 Worktrees represent live state

A worktree is an active editable representation of repository state.

Worktrees MUST NOT be created merely to represent every historical version.

For example, this is undesirable:

+++text
Version 1 -> Worktree
Version 2 -> Worktree
Version 3 -> Worktree
Version 4 -> Worktree
+++

Historical state already belongs in Git:

+++text
commit A
   |
commit B
   |
commit C
   |
commit D
+++

Craidd should retrieve historical files directly from Git objects.

Worktrees should be reserved for states that need to remain independently
editable.

---

### 3.4 Windows and workspaces are not necessarily one-to-one

Multiple Craidd windows MAY attach to the same workspace.

For example:

+++text
Workspace: main
  ├── Window A
  └── Window B
+++

Both windows intentionally observe the same filesystem and therefore the
same dirty state.

Alternatively:

+++text
Window A -> Workspace main
Window B -> Workspace feature/renderer
+++

Those windows observe independent filesystems.

Craidd MUST distinguish these two cases.

Opening another window must not implicitly create another worktree unless
the user explicitly requests an isolated workspace or a feature requires
one.

---

## 4. Terminology

### Repository

The underlying Git repository and shared object database.

### Branch

A named Git reference representing a development timeline.

### Worktree

A Git working tree with its own checkout, HEAD and index while sharing the
repository's Git objects and refs.

### Workspace

Craidd's logical representation of an editable project instance.

A workspace may be backed by a Git worktree.

### Managed workspace

A workspace/worktree created and lifecycle-managed by Craidd.

### External workspace

An existing worktree or ordinary checkout discovered/opened by Craidd but
not originally created by Craidd.

### Session

Runtime Craidd state associated with one or more windows and workspaces.

---

## 5. Workspace architecture

The expected high-level relationship is:

+++text
Craidd Solution / Project
          |
          v
    Git Repository
          |
     Workspace Manager
          |
    +-----+----------------------+------------------+
    |                            |                  |
    v                            v                  v
Workspace A                  Workspace B        Workspace C
main                         feature/ldi        agent/bug-fixes
    |                            |                  |
Worktree A                   Worktree B         Worktree C
    |                            |                  |
Window(s)                    Window(s)           Agent
+++

All worktrees share repository history while retaining independent live
filesystem state.

---

## 6. Workspace identity

Craidd should assign each managed workspace a stable identifier independent
of its branch name.

Branch names are not sufficient identity because:

- HEAD may be detached;
- branches can be renamed;
- branches can be deleted;
- a workspace may change branches;
- temporary agent workspaces may not initially have a named branch.

Example conceptual metadata:

+++json
{
  "workspace_id": "7f12d4c8",
  "repository_id": "craidd-studio",
  "kind": "managed-worktree",
  "path": "/home/user/.local/share/craidd/worktrees/craidd-studio/7f12d4c8",
  "branch": "feature/ldi",
  "head": "6cb7df1",
  "owner": "window",
  "persistent": true
}
+++

The exact schema is implementation-defined.

The important requirement is that workspace identity MUST NOT depend solely
on the current branch name.

---

## 7. Managed worktree location

Craidd-created worktrees should normally live outside the user's primary
project directory.

A possible location is:

+++text
~/.local/share/craidd/worktrees/
  <repository-id>/
    <workspace-id>/
+++

For example:

+++text
~/.local/share/craidd/worktrees/
  craidd-studio/
    82ac91/
    7f12d4/
    f120bb/
+++

This avoids filling the repository root with implementation directories such
as:

+++text
Craidd-Studio-feature-a/
Craidd-Studio-feature-b/
Craidd-Studio-agent-3/
+++

The actual location should remain configurable where appropriate.

Craidd MUST NOT assume all Git worktrees are Craidd-managed.

---

## 8. Workspace Manager

Craidd should expose a Workspace Manager responsible for discovering and
managing editable project instances.

Responsibilities include:

- enumerate repository worktrees;
- identify the primary worktree;
- identify Craidd-managed worktrees;
- create isolated workspaces;
- open existing workspaces;
- determine workspace branch/HEAD;
- determine dirty state;
- determine whether a workspace is currently attached to a Craidd window;
- determine whether a workspace is owned by an agent;
- safely remove obsolete managed worktrees;
- recover persistent workspaces after restart;
- detect externally removed or invalid worktrees.

Possible UI:

+++text
WORKSPACES — Craidd-Studio

● main
  Main Workspace
  4 modified files
  Window 1

● feature/ldi
  LDI Development
  12 modified files
  Window 3

● agent/ldi-debug-fixes
  Agent Workspace
  3 modified files
  Agent running

○ experiment/render-cache
  Clean
  Not currently open
+++

---

## 9. Creating an isolated workspace

Craidd may expose commands such as:

+++text
Craidd: Create Workspace
Craidd: Open Branch in New Workspace
Craidd: Open in Isolated Workspace
Craidd: Move Window to Workspace
Craidd: Manage Workspaces
+++

Creating a workspace from a branch conceptually performs:

+++text
Select repository
      |
Select/create branch
      |
Create Git worktree
      |
Register Craidd workspace
      |
Open workspace
+++

Craidd should surface errors from Git rather than attempting to bypass Git's
branch/worktree safety rules.

---

## 10. Multi-window behaviour

Craidd is expected to support many simultaneous windows.

A user may therefore have:

+++text
Window 1 -> Craidd-Studio / main
Window 2 -> Craidd-Studio / feature/ldi
Window 3 -> Craidd-Studio / debug/threading
Window 4 -> GameProject / main
Window 5 -> GameProject / renderer
Window 6 -> PHPue / main
Window 7 -> Website / redesign
Window 8 -> Craidd-Studio / main
+++

Window 1 and Window 8 intentionally share a workspace.

Changes written by Window 1 are therefore visible to Window 8.

Window 2 has an independent filesystem because it is attached to another
worktree.

The UI should make this distinction discoverable.

---

## 11. Dirty-state tracking

Each workspace should maintain its own observable dirty state.

At minimum Craidd should distinguish:

+++text
Clean
Modified
Staged
Untracked
Conflicted
Detached
Missing/Invalid
+++

The Workspace Manager may aggregate this into project-level information,
but the source of truth remains the individual workspace.

Example:

+++text
Craidd-Studio                         3 active workspaces

main                                 clean
feature/ldi                           7 modified
agent/debug-fixes                     2 modified, 1 untracked
+++

Craidd SHOULD avoid hiding dirty workspaces merely because no window is
currently attached to them.

---

## 12. Persistence across Craidd restarts

A worktree exists independently of the Craidd process.

Therefore disk-backed dirty state may survive:

- window closure;
- IDE restart;
- Craidd crash;
- machine restart.

On startup Craidd may rediscover managed workspaces and offer session
restoration.

Example:

+++text
Previous workspaces found

Craidd-Studio

main
  4 modified files

feature/ldi
  12 modified files

agent/debug-fixes
  3 modified files

[Restore All] [Choose Workspaces] [Dismiss]
+++

Craidd MUST NOT equate persistent worktree dirty state with complete editor
recovery.

---

## 13. Unsaved editor buffers

Git can only observe filesystem state.

If the user changes an editor buffer but Craidd has not written that buffer
to disk, neither Git nor the worktree can preserve those changes.

Therefore:

+++text
Worktree persistence != unsaved-buffer persistence
+++

Craidd requires a separate editor recovery mechanism.

Conceptually:

+++text
User input
    |
Editor buffer
    |
    +----> Recovery journal
    |
    +----> Save
             |
             v
          Worktree
             |
             v
             Git
+++

A crash recovery system should be capable of restoring editor buffers newer
than the latest disk version.

The recovery system MUST NOT require creating Git commits for every
keystroke or editor mutation.

---

## 14. Project history

Craidd should separate:

+++text
LIVE STATE                       HISTORICAL STATE

Worktree                         Commit
Dirty filesystem                 Git object
Editor buffer                    Historical blob
Active branch                    Revision
+++

Git should remain the source of truth for committed historical state.

Craidd MAY maintain additional metadata describing why a particular
historical point matters.

For example:

+++text
.craidd/
  project_history/
    index.json
    recovery/
+++

Possible history metadata:

+++text
revision: 184
label: "Before LDI refactor"
commit: a38fc21
source: agent-checkpoint
timestamp: ...
+++

This metadata should reference Git state rather than duplicate complete
project worktrees.

---

## 15. File History

Craidd should expose:

+++text
Craidd: View File History
+++

The command operates on the current file or allows the user to locate a file.

Example:

+++text
FILE HISTORY — src/editor/editor.cpp

Current     Current disk version
10:41       Fixed selection handling
10:12       Before LDI refactor
09:47       Added thread preview
Yesterday   Initial editor rewrite
+++

Selecting a revision should retrieve that file directly from Git.

Conceptually:

+++bash
git show <revision>:<path>
+++

Craidd MUST NOT switch the current workspace branch merely to display a
historical file.

Craidd SHOULD NOT create a worktree solely for this operation.

---

## 16. Historical diff viewer

Selecting a historical revision opens a two-panel comparison.

+++text
+------------------------------+------------------------------+
| HISTORICAL VERSION           | CURRENT DISK VERSION         |
|                              |                              |
| src/editor/editor.cpp        | src/editor/editor.cpp        |
| commit a38fc21               | Workspace: feature/ldi       |
|                              |                              |
| - old implementation         | + new implementation         |
|   unchanged                  |   unchanged                  |
|                              |                              |
+------------------------------+------------------------------+
+++

Default semantic direction:

+++text
Historical -> Current
+++

Therefore:

- removals from the historical version are represented on the left;
- additions in the current version are represented on the right;
- unchanged regions remain neutral.

When comparison direction is reversed, the semantics should reverse as
well.

Possible actions:

- Restore File
- Restore Selection
- Copy From Historical
- Open Historical Revision Read-Only
- Compare With Another Revision
- Copy Revision Identifier
- View Commit
- Close Comparison

---

## 17. Restoring historical content

Restoring an old version of a file should normally modify the current editor
buffer/workspace.

Craidd should avoid changing HEAD merely to restore one file.

Conceptually:

+++text
Historical Git blob
       |
       v
Current editor buffer
       |
       v
User reviews change
       |
       v
Normal save/commit workflow
+++

Restoration should therefore itself appear as a normal current modification.

Where possible it should participate in the editor's undo system.

---

## 18. Agent workspaces

Coding agents are a strong use case for worktree-backed workspaces.

Instead of:

+++text
Human + Agent A + Agent B
           |
           v
    same working directory
+++

Craidd should support:

+++text
Repository
    |
    +---- Human Workspace
    |
    +---- Agent Workspace A
    |
    +---- Agent Workspace B
+++

Each mutation-capable agent can receive an isolated worktree.

Conceptually:

+++text
Task
  |
Branch / detached base
  |
Worktree
  |
Agent
  |
Verification
  |
Commit(s)
  |
Review / Integration
+++

An agent MUST NOT require the user's active workspace to switch branches.

Agent changes should become visible to the user through workspace status,
diffs, commits, and explicit integration.

---

## 19. Agent integration

Agent completion does not imply automatic integration.

Possible states include:

+++text
Running
Awaiting verification
Failed verification
Ready for review
Ready to merge
Conflict detected
Integrated
Discarded
+++

Craidd may eventually provide:

+++text
Agent: LDI Bug Fixes

Branch: agent/ldi-debug-fixes
Workspace: 723a
Changes: 7 files
Tests: Passed
Conflicts with target: None

[Review Changes]
[Open Workspace]
[Merge]
[Discard]
+++

Merge policy is outside the core worktree abstraction and should remain an
explicit higher-level operation.

---

## 20. Remote workspaces

Remote editing may use the same conceptual abstraction.

+++text
Repository
   |
   +-- Local Workspace
   |
   +-- Remote Workspace
+++

A remote actor can modify an isolated worktree without forcing the local
workspace to change branches.

The transport and synchronisation implementation is outside this document.

The important architectural property is that Craidd's Workspace API should
not assume the only possible owner is a local IDE window.

A workspace owner may eventually be:

+++text
Human Window
Agent
Remote Session
Background Tool
+++

---

## 21. Debugging and profiling

Debugging and profiling features MAY attach to a workspace.

This matters because binaries, source state, build directories and runtime
configuration can differ between worktrees.

A debugging session should therefore know:

+++text
repository
workspace
HEAD
branch
source root
build root
+++

rather than referring only to a project globally.

This avoids accidentally debugging binaries produced by another active
workspace.

---

## 22. Build artefacts and external resources

Git worktrees isolate tracked source files but do not provide complete
process or machine isolation.

Potential shared resources include:

- TCP/UDP ports;
- Docker containers;
- external databases;
- system temporary directories;
- global package caches;
- user configuration;
- environment variables;
- shared build caches.

For example:

+++text
Workspace A -> application tries port 8000
Workspace B -> application tries port 8000
                          |
                          v
                       conflict
+++

Craidd MUST NOT advertise worktrees as equivalent to containers.

Workspace-specific runtime and build configuration may eventually be needed
where collisions are possible.

---

## 23. Worktree cleanup

Managed worktrees consume disk space.

Craidd should therefore distinguish:

+++text
Persistent workspace
Temporary workspace
Agent workspace
Abandoned workspace
+++

A managed workspace MUST NOT be automatically deleted while it contains
uncommitted changes unless an explicit safe policy permits it.

Before removal Craidd should inspect:

- dirty files;
- untracked files;
- staged files;
- unmerged commits where relevant;
- active windows;
- active agents/processes.

Potential UI:

+++text
Remove workspace "agent/ldi-fix"?

This workspace contains:
  3 modified files
  1 untracked file
  2 commits not present in main

[Cancel]
[Archive/Commit...]
[Discard Workspace...]
+++

Destructive removal must be deliberate.

---

## 24. Detached HEAD

Craidd must support worktrees whose HEAD is detached.

This is particularly relevant for automatically created agent workspaces.

Detached state should not be treated as corruption.

Example:

+++text
Workspace: Agent — LDI Review
HEAD: 6cb7df1
Branch: Detached
+++

If persistent changes need to become a named development timeline, Craidd
may offer:

+++text
Create Branch From Workspace
+++

---

## 25. External Git operations

Users may manipulate worktrees using Git outside Craidd.

Therefore Craidd must tolerate:

- externally created worktrees;
- externally removed worktrees;
- branch changes;
- branch renames;
- detached HEAD;
- external commits;
- external dirty changes.

Craidd should reconcile its workspace metadata with Git rather than assuming
its cached state is authoritative.

Git remains authoritative for Git state.

---

## 26. `.craidd` responsibility

`.craidd` should contain Craidd-specific metadata, not duplicate Git's object
model.

Appropriate:

+++text
.craidd/
  workspaces/
    metadata.json

  project_history/
    index.json
    recovery/

  sessions/
    ...
+++

Inappropriate:

+++text
.craidd/project_history/version-001/<entire repository>
.craidd/project_history/version-002/<entire repository>
.craidd/project_history/version-003/<entire repository>
+++

Git already solves historical content storage more efficiently.

---

## 27. Suggested feature commands

Potential command-palette entries:

+++text
Craidd: Manage Workspaces
Craidd: Create Workspace
Craidd: Open Branch in New Workspace
Craidd: Open in Isolated Workspace
Craidd: Close Workspace
Craidd: Remove Workspace
Craidd: Create Branch From Workspace

Craidd: View File History
Craidd: View Project History
Craidd: Compare With Revision
Craidd: Restore Historical Version

Craidd: Restore Previous Session
Craidd: View Recovery State
+++

Names are provisional.

---

## 28. Suggested implementation stages

### Git workspace stage 0 — Git/worktree discovery

Implement read-only understanding of:

- repository root;
- current worktree;
- available worktrees;
- HEAD;
- branch;
- dirty state.

No worktree mutation.

### Git workspace stage 1 — Workspace model

Introduce Craidd's internal Workspace abstraction.

Remove assumptions that:

+++text
Project == working directory
+++

or:

+++text
Project == one Git status
+++

Allow multiple windows to identify which workspace they belong to.

### Git workspace stage 2 — Managed worktrees

Implement:

- create;
- register;
- open;
- close;
- inspect;
- safely remove.

Add:

+++text
Open Branch in New Workspace
+++

### Git workspace stage 3 — File History

Implement:

- history query for current file;
- historical Git blob retrieval;
- read-only historical editor;
- revision metadata.

No branch switching should occur.

### Git workspace stage 4 — Diff and restore

Implement the two-panel historical/current comparison.

Support:

- file restore;
- selection restore;
- historical copy;
- editor undo integration.

### Git workspace stage 5 — Workspace persistence

Persist managed workspace metadata.

Restore/discover workspaces after Craidd restart.

Expose orphaned/dirty workspaces.

### Git workspace stage 6 — Editor recovery

Implement recovery journalling for unsaved in-memory buffers.

Keep this independent from Git commits/worktrees.

### Git workspace stage 7 — Agent workspaces

Expose workspace creation/lifecycle to Craidd agents.

Each mutation-capable parallel agent may receive an isolated workspace.

Add review/integration workflow.

### Git workspace stage 8 — Remote workspaces

Extend the workspace ownership model to remote sessions.

Transport design should be handled separately.

---

## 29. Non-goals

This design does not require:

- replacing Git;
- committing every editor save;
- committing every keystroke;
- creating a worktree for every historical revision;
- automatically merging every agent branch;
- treating worktrees as containers;
- hiding Git from advanced users;
- requiring every Craidd window to have a unique worktree.

---

## 30. Safety invariants

The following should be treated as architectural invariants.

### Invariant 1 — History inspection is non-mutating

Opening historical content MUST NOT silently change the user's current
branch or worktree.

### Invariant 2 — Workspace creation is isolated

Creating an isolated workspace MUST NOT change another workspace's checked
out state.

### Invariant 3 — Dirty workspaces are protected

Craidd MUST NOT delete a dirty managed workspace without explicit safe
handling.

### Invariant 4 — Worktrees do not protect RAM-only edits

Unsaved editor buffers MUST NOT be considered protected merely because the
workspace is a Git worktree.

### Invariant 5 — Git state is workspace-scoped

Git dirty state belongs to the workspace/worktree that owns it.

### Invariant 6 — Human workspaces remain human workspaces

A user workspace MUST NOT be silently repurposed as an agent workspace.

### Invariant 7 — Integration is explicit

Integration between independently modified workspaces MUST remain explicit
and reviewable.

---

## 31. Example complete workflow

The user opens Craidd Studio:

+++text
Craidd-Studio
└── main
+++

They begin implementing LDI:

+++text
Craidd-Studio
├── main
└── feature/ldi
+++

A bug is discovered while LDI work continues.

Craidd creates:

+++text
Craidd-Studio
├── main
├── feature/ldi
└── fix/editor-crash
+++

An agent is assigned another issue:

+++text
Craidd-Studio
├── main
├── feature/ldi
├── fix/editor-crash
└── agent/thread-preview
+++

All four states share repository history but retain independent filesystem
state.

The user can inspect:

+++text
WORKSPACES

main                    clean
feature/ldi             11 modified
fix/editor-crash         2 modified
agent/thread-preview     ready for review
+++

The agent completes its work.

Craidd opens a diff against the intended integration target.

The user reviews and merges it.

No other workspace needed to switch branch or discard dirty state during
the operation.

Later, the user opens File History for:

+++text
src/editor/editor.cpp
+++

Craidd retrieves the selected historical Git blob directly and displays:

+++text
Historical Version | Current Disk Version
+++

Again, no workspace needs to change branch.

This is the intended separation between:

+++text
history    -> Git revisions
live state -> worktrees
UI         -> Craidd workspaces/windows
+++

---

## 32. Future extensions

The Workspace abstraction may eventually support:

- workspace templates;
- ephemeral review environments;
- agent pools;
- parallel test environments;
- branch comparison workspaces;
- remote development;
- collaborative review;
- workspace-specific build configuration;
- workspace-specific debugger state;
- workspace-specific terminal sessions;
- visual branch/workspace topology;
- automatic conflict prediction before integration.

These should build on the core model rather than changing it.

---

## 33. Final model

The intended Craidd model is:

+++text
                        CRAIDD SOLUTION
                              |
                              v
                           PROJECT
                              |
                              v
                        GIT REPOSITORY
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
         WORKSPACE A      WORKSPACE B      WORKSPACE C
              |               |               |
              v               v               v
         WORKTREE A       WORKTREE B       WORKTREE C
              |               |               |
          main branch     feature branch    agent branch
              |               |               |
              v               v               v
         IDE Window       IDE Window         Agent
+++

Historical state is orthogonal:

+++text
                        GIT REPOSITORY
                              |
                              v
                         COMMIT HISTORY
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
           commit A        commit B        commit C
              |
              v
        historical blob
              |
              v
       File History / Diff
+++

Recovery is also orthogonal:

+++text
Editor Buffer
     |
     +----> Disk / Worktree
     |
     +----> Recovery Journal
+++

These mechanisms complement each other but MUST NOT be conflated.

The resulting model gives Craidd a foundation for:

**multiple windows, multiple branches, multiple agents, remote sessions,
persistent dirty workspaces, historical inspection, and safe integration —
without forcing those actors to share one mutable checkout.**

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a design.*
