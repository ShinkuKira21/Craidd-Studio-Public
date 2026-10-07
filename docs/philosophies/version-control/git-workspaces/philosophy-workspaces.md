# Git workspaces: philosophy

| | |
|---|---|
| **Author** | OpenAI GPT-5.6 Sol |
| **Date** | 2026-10-07 |
| **Status** | Feature philosophy |
| **Feature** | Git Workspaces |
| **Companion design** | [Worktree architecture](../../../feats/version-control/git-workspaces/design-worktree-workspaces.md) |
| **Source** | Design discussion with skira24 |

---

## The project is not the folder

Craidd must not build its project model around the assumption that one
project has one directory, one branch, one dirty state, and one active
developer.

That assumption is convenient.

It is also increasingly false.

A modern development environment may contain:

- multiple IDE windows;
- multiple branches under active development;
- local and remote editing sessions;
- debugging and profiling processes;
- coding agents;
- review agents;
- background tooling;
- unfinished experimental work.

The repository is the common history connecting these activities.

The filesystem checkout is merely one **live view** of that history.

---

## A workspace is a live state

Craidd should think in terms of workspaces.

A workspace answers:

> What editable state of this project am I interacting with right now?

For Git projects, a worktree provides an excellent implementation primitive
for that concept.

+++text
Repository
    |
    +-- Workspace
    |      |
    |      +-- Worktree
    |
    +-- Workspace
    |      |
    |      +-- Worktree
    |
    +-- Workspace
           |
           +-- Worktree
+++

Each workspace may move independently while retaining access to the same
repository history.

---

## History and workspace are different concepts

Craidd should never confuse historical versions with active workspaces.

A historical version answers:

> What did this project/file look like at another point in history?

A workspace answers:

> What state am I actively editing?

Therefore:

+++text
Commit   = historical checkpoint
Branch   = development timeline
Worktree = live editable checkout
Workspace = Craidd's representation of that checkout
Window   = a view into a workspace
+++

This distinction keeps the architecture understandable.

---

## Dirty state is valuable state

An uncommitted workspace is not inherently broken, temporary, or disposable.

It may represent hours of legitimate work.

Craidd should treat dirty state as first-class project state.

If the user has:

+++text
main                  clean
feature/renderer      14 modified files
experiment/threads     7 modified files
+++

then all three states matter.

Closing the IDE should not make Craidd conceptually forget that the other
two exist.

A persistent worktree allows disk-backed dirty state to survive independently
of the Craidd process.

Craidd should respect that persistence.

---

## Windows should not fight each other

Opening another Craidd window should never imply that one window owns the
entire repository.

Two windows may intentionally share one workspace.

Two other windows may intentionally operate against independent workspaces.

Both are valid.

+++text
Window A -----+
              +---- Workspace main
Window B -----+

Window C ---------- Workspace feature/renderer

Window D ---------- Workspace debug/threading
+++

Craidd should make this relationship explicit rather than hiding it behind
a global current-project state.

---

## Agents are developers with isolated workspaces

An agent capable of modifying a repository should not casually share a
mutable checkout with another actor.

The safer abstraction is:

+++text
One mutation task
      |
One workspace
      |
One worktree
      |
One development timeline
+++

Parallel agents therefore become:

+++text
                       Repository
                           |
             +-------------+-------------+
             |             |             |
          Agent A        Agent B       Agent C
             |             |             |
        Workspace A    Workspace B   Workspace C
             |             |             |
        Worktree A     Worktree B    Worktree C
+++

Their work meets during deliberate integration, not accidental filesystem
contention.

---

## Integration is a separate act

Parallelism should not imply automatic merging.

Creating code and integrating code are different responsibilities.

An agent may finish successfully while its changes remain unsuitable for
integration.

Craidd should preserve that distinction:

+++text
Create
  |
Verify
  |
Review
  |
Integrate
+++

A workspace can therefore be successful without immediately changing the
user's active branch.

This is desirable.

---

## Git should remain Git

Craidd should not invent a replacement version-control model where Git
already provides the required semantics.

Git owns:

- commits;
- objects;
- branches;
- refs;
- worktrees;
- merges;
- conflicts;
- historical content.

Craidd owns:

- presentation;
- workspace identity;
- session state;
- user intent;
- recovery metadata;
- agent ownership;
- IDE commands;
- safe lifecycle management.

The boundary should remain clear.

---

## Advanced users should not be trapped

Craidd-managed workspaces must coexist with normal command-line Git.

A user should remain free to use:

+++bash
git status
git branch
git log
git worktree list
git worktree add
git switch
git merge
+++

Craidd should observe and reconcile external Git changes.

It should not require the repository to exist only inside a Craidd-owned
universe.

This matters especially for an open-source developer IDE.

---

## Recovery is broader than Git

Git protects filesystem state that has been written and historical state
that has been committed.

It cannot protect text that exists only inside an editor's memory.

Therefore Craidd's recovery philosophy must be:

+++text
Git history       protects committed state
Worktrees         preserve independent disk state
Recovery journal  protects unsaved editor state
+++

No one mechanism should pretend to replace the others.

---

## History should feel native to editing

File history should not feel like leaving the editor and entering a Git
administration tool.

The user should be able to ask:

> What did this file look like before?

and receive:

+++text
Historical Version            Current Disk Version
──────────────────            ────────────────────
old implementation            current implementation
removed lines                 added lines
unchanged                     unchanged
+++

The implementation may use Git commits and blobs.

The experience should remain an editor experience.

---

## Workspaces should enable experimentation

One of the strongest benefits of isolated workspaces is psychological as
well as technical.

A developer should be able to say:

> I want to try this without disturbing what I'm doing.

Craidd can answer by creating another workspace.

+++text
Stable work
    |
    +---- Experiment A
    |
    +---- Experiment B
+++

If Experiment B fails, it can be discarded.

If it succeeds, it can be reviewed and integrated.

The original workspace remains untouched.

---

## Parallel development should become ordinary

Craidd should be designed for a future where this is unremarkable:

+++text
Human:
  implementing editor behaviour

Agent A:
  fixing debugger bugs

Agent B:
  writing tests

Remote session:
  investigating rendering

Background tool:
  profiling build output
+++

The IDE architecture should not require all of these actors to queue behind
one global working directory.

Git worktrees provide the filesystem-level primitive.

Craidd Workspaces provide the IDE-level abstraction.

---

## The core philosophy

Craidd should treat a repository as a **shared history**, not a single
mutable folder.

A project may have many live states.

Those states should be isolated when necessary, persistent when valuable,
inspectable at all times, and integrated deliberately.

The resulting hierarchy is:

+++text
Repository
    |
    +-- History
    |     |
    |     +-- commits
    |     +-- revisions
    |     +-- file versions
    |
    +-- Workspace
    |     |
    |     +-- human
    |
    +-- Workspace
    |     |
    |     +-- agent
    |
    +-- Workspace
          |
          +-- remote / experimental / debugging
+++

This gives Craidd a simple principle to carry into future features:

> **History records what happened.**
>
> **Workspaces represent what is happening.**
> Integration decides what becomes shared.**

---

*Last updated: Phase 0 philosophy. Author: skira24.*