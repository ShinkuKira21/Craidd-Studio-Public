# AGENT.md

Read this first if you are an automated agent working on this repository.

## Order of reading

1. This file.
2. `docs/working-protocol.md` — how work proceeds here.
3. `docs/roadmaps/Roadmap-v0.0.4A.md` — the current plan.
4. `docs/craidd-cln-model.md` — the project model.

## What this repository is

Craidd Studio is a polyglot IDE for Linux. The code may be shaped
quickly, by hand or by tool. The docs are the load-bearing layer:
they carry the design across sessions, and a doc that loses its
shape has lost the design.

## Documentation shape

Every document in docs/ ends with two lines:

```
*Last updated: {phase or date}. Author(s): {git-username}, {git-username[1]}...*
*This document is a {design | philosophy | plan | record | placeholder}.*
```

The Author field names a Git contributor — a person whose username
appears in this repository's commit history. An agent does not have
a Git username, so an agent's name does not appear in a footer.=
Author(s) can increase if a new contributor makes edits to the docs.