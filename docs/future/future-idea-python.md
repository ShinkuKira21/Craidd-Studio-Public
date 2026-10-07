# FUTURE_IDEA: Python and ML tooling in Craidd-Studio

**Roadmap track:** Later Python/ML direction, unassigned. See the [current roadmap](../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Future direction. Not a phase. Not a plan. A record of
*why* Python matters to this project beyond "another language",
written so that the reasoning is available when the time comes.

**Gate:** This Python/ML expansion is later, unassigned work. Its
prerequisites are outcome-based rather than the old “Phases 1–5” shorthand:

- Rust, TypeScript, C++ and C# — accepted editing, LSP, build and debug paths
- Accepted managed/native and native/native workflows
- Linux open-source release and real-world usage
- Python language/runtime support before the ML views described here

The original language prerequisites remain. Python/native proof belongs to
the later Python work and must precede the ML-specific views; no new delivery
phase is assigned here.

Only then does this file move from "future" to "considered".

---

## Why Python specifically

Python is not just "another language". It is the only language in the
Craidd stack that gives us *three* separate things at once:

1. **A second multi-language archetype.** Rust + C++ tests the native
   case. C# + C++ tests the managed/native case. Python + C extensions
   tests a third: an interpreter hosting native code through its own
   C API. If Craidd handles all three, the polyglot model is proven
   against every way languages can mix.

2. **A first-class user base.** The Python audience is large,
   technically sophisticated, and underserved by IDE tooling in
   exactly the way Craidd is designed to fix.

3. **The bridge to ML/DL workflows.** Every serious ML codebase is
   polyglot. Python orchestrates. C++ or CUDA does the hot loops.
   Rust or Go runs the serving layer. YAML holds the configs.
   Jupyter explores. No existing IDE treats this whole thing as one
   project. Craidd could.

---

## What "supporting Python" means

Nothing exotic. The same pattern as every other language:

- Python project in `.craidd` (`language = "python"`)
- `pyright` for LSP (the user installs it)
- `debugpy` for DAP (the user installs it)
- Interpreter discovery: `.venv/`, `venv/`, `env/`, then `pyproject.toml`
  hints (`uv`, `poetry`, `pdm`), then `.python-version`, then system
- Interpreter path stored in `.craidd` so it travels with the project
- Build/run/debug commands stored in `.cln` so they're solution-specific

That is it. Python is not a special case at the language level. It is
a table entry in `src/lib/languages.ts` plus a small
"interpreter-discovery" helper.

---

## What makes Python *interesting* later

Once the foundation exists, Python opens a door that no other
language opens: **Craidd could be the first IDE to treat ML/DL
projects as first-class project types rather than as "Python scripts
with extra files".**

The shape would be:

### Project kinds beyond "application"

A `.craidd` file could declare what kind of project it is:

+++
[project]
name = "training"
language = "python"
kind = "model"
+++

Possible kinds:
- `application` — the default
- `library` — no entry point
- `test` — test runner
- `model` — a training script with checkpoints and metrics
- `dataset` — a data source with schema
- `kernel` — performance-critical native code (CUDA, C++)
- `service` — a serving endpoint

Each kind could gain its own view, its own tools, its own default
run configuration. Not a separate mode. A different *interpretation*
of the same project.

### A "Training" view, not a Jupyter notebook

The bottom panel already has tabs (Output, Problems, Terminal). It
could gain a **Training** tab. That tab, while a `kind = "model"`
project is running, could show:

- Live loss curve
- Live accuracy / metric curves
- Step count and ETA
- GPU memory usage
- Checkpoint files as they appear
- Dataset version and configuration

The right sidebar already has sections (Call Stack, Variables, Watch,
Breakpoints). It could gain **Model State** sections:

- Current learning rate
- Number of parameters
- Gradient norm
- Recent layer activations

None of that would require a new architecture. It is using the same
panels for a different purpose.

### Debugging a training run

The debug context dropdown already exists (Phase 3). It could gain a
"Training Run" context.

Behavior:
- Press F5 → a training session starts
- The Training tab begins drawing
- The debug context dropdown shows "Training (Running)"
- A red dot appears next to the training project in the tree

The user notices the loss spike at step 3000. They click the spike
in the chart. The editor jumps to the corresponding line in the
training script. They set a conditional breakpoint (`step == 3000`).

Next run: the debugger pauses at step 3000. The loss chart *freezes*.
The Python debugger shows variables. The step where the model broke
is on screen. The user inspects. They step through. They find the
bug. They resume. The chart continues.

**That is not Jupyter.** Jupyter's "debug" is a cell you re-run with
print statements. That is engineering with a real debugger attached
to a real run, with the model's own metrics visible in the same IDE.

### Evaluation as its own view

Once training works, evaluation is the same pattern:

- Load a checkpoint (from the Training view)
- Run an evaluation script
- Display a confusion matrix
- Display precision / recall / F1
- Compare against previous runs

The comparison view is the interesting part. Being able to say "this
checkpoint vs. that checkpoint, same test set, side by side" is
something no IDE does inside itself today. It is what a studio does.

### Why this is not "adding AI features"

There is a difference between:

**"We added a chat panel and called it an AI IDE."**
A trend. Disposable. Solves nothing durable.

**"We built an IDE that treats ML projects as the polyglot systems
they actually are."**
Durable. Solves a problem that will exist in ten years because ML
codebases will still be polyglot, and someone will still need to
debug the native kernel that Python is calling.

Craidd is aiming at the second.

---

## Why Jupyter is not the answer

Jupyter is good at *exploration*. It is bad at *engineering*:

- No debugger (only re-run cells and print)
- No project model (everything is a notebook)
- No proper file editing (cells, not source files)
- No build system, no dependency graph, no reproducible pipeline
- Hidden state from out-of-order cell execution is a debugging
  nightmare by design
- It is a *different mental model* from the code that ships

VS Code's Jupyter integration is the best in the industry, and it
is still "here is an editor, and here is a notebook, and they kind
of talk to each other".

A studio says: **this is one project. Here is its code. Here is its
training. Here is its evaluation. Here is its deployment.** All in
one place. All debugging through the same debugger. All visible at
once.

That is the direction. It is years away. But it is real.

---

## What must be true first

Before any of this becomes worth building, the foundation must exist:

- [ ] Rust, TypeScript, C++, C# — file editing, saving, LSP, debug
- [ ] Python — interpreter discovery, LSP, debug (no ML tooling)
- [ ] Project kinds in `.craidd` (`application`, `library`, `test`)
- [ ] LSP bridge shared across all languages
- [ ] DAP bridge shared across all languages
- [ ] Debug context dropdown (already designed, not yet built)
- [ ] Build orchestration (`Ctrl+B` runs build commands from `.cln`)
- [ ] Open source release and real user feedback

Only after those are true does "Training view" become a decision
instead of a distraction.

---

## Why we are writing this down now

Because the idea is real, and because it is worth remembering *why*
Python matters. It is not a nice-to-have. It is the language that
turns Craidd from "a polyglot IDE" into "a studio for the projects
that use every language at once".

But none of that can exist until the IDE works for one language.
Rust first. Then TypeScript. Then C++. Then C#. Then Python.

Then, and only then, the studio.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a record.*
