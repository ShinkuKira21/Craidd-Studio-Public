# Forks

This folder exists so a fork can **declare itself** before it tries to change anything.

A fork is not a PR. A PR is *aligned* — it sharpens the current shape. A fork is *divergent* — it proposes a different shape. Both are welcome. They arrive differently, and they are reviewed differently.

If you want a fork of this project to exist, write a markdown file inside `docs/forks/your-fork/`. That is the entire requirement. Upstream may later promote a mature fork into `docs/feats/your-fork/` — same content, different folder, once it has earned a place next to the main design.

---

## Who opens what

Two populations, two surfaces.

| Who | Surface | What they bring |
| --- | --- | --- |
| **Users** | Git issues | "This is broken." "This is missing." "This is confusing." |
| **Contributors** | `docs/forks/<name>/` and PRs | "Here is a plan," or "here is a plan and a solution." |

A contributor does not need to open an issue first. The plan *is* the opening. An issue is a complaint; a fork is a reason. They are different objects, and they belong in different places.

Contributors may also contribute by **doc refinement alone**, without writing any code. That is a first-class contribution track, reviewed on the same terms as a code PR. See "The unit of contribution" below.

---

## The unit of contribution is a reason

The thing you are shipping is not a feature. It is not a patch. It is a **reason** — an argument about why the current shape is wrong, or insufficient, or incomplete, and what shape would be better.

The reason can arrive alone. The reason can arrive with code. The reason cannot arrive *absent*.

That gives three legal shapes for a submission:

| Shape | Accepted? | Why |
| --- | --- | --- |
| **Design plan only** | Yes | The reason is the submission. Upstream may rebuild it structurally, in its own idiom, later. |
| **Code only** | No | The reason is missing. A future reader of the repo cannot tell whether this code implements a decision or merely happens to work. |
| **Design plan + code** | Yes | The reason is stated; the code is downstream of it. Reviewed for plausibility, then cross-checked with AI and tested for performance and bugs. |

Code-only submissions are not rejected out of hostility. They are **held** until a reason arrives. Code without a reason is a claim without an argument. The repo can survive a bad argument; it cannot survive an absent one.

---

## What goes in your fork's markdown

Answer three questions. No more.

1. **What does this fork change?** — the delta, not a restatement of the whole project.
2. **Why can't it be a feature inside the current model?** — this is the load-bearing question. If it can, it should be a PR to `docs/`, not a fork. Forks are for when the current shape cannot hold the idea.
3. **What does it break if upstream merges it?** — an honest cost estimate, so promotion is a decision and not a discovery.

Anything else — implementation, roadmap, philosophy, examples — belongs in your fork's own documentation and can be pulled up later if it graduates. The file in this folder is a **receipt**, not a manual.

Keep it short. The same restraint that governs `.craidd` governs this: five lines is better than fifty, and every line should earn its place.

---

## On AI-generated docs

AI-generated docs are welcome. So are AI-rewrites of human docs. There is no stigma attached to either, and no "please disclose" ceremony. The contributor owns the doc, not the model that drafted it.

What matters is that the rewrite **preserves claims**.

That means two rules, and they are not negotiable:

**1. Every substantive claim survives the rewrite.**

The test is not "does it read better." The test is "can you diff the rewrite against the original and see that the same claims are still there." If a claim weakens — if "this will break LDI" becomes "this may affect some debugging features" — that is not translation. It is laundering. The reviewer will ask where the claim went, and the answer has to be "it was wrong," not "it felt smoother."

**2. Uncertainty survives the rewrite.**

The *confidence level* of a claim is itself a claim. If the original said "this might break X," the rewrite says "this might break X." Not "this could affect X." Not "X may be impacted." You can rewrite the sentence; you cannot change the certainty.

This is the same rule the design docs already follow everywhere else — detection has confidence levels (`detected ✓` / `likely` / `no signal`), threads have an `unknown` state, LDI has explicit unsupported-input refusals. Blurring a confidence level is a bug in prose the way it is a bug in code. A perfectly smooth doc that hides its own uncertainty says *what* but not *how sure*, and "how sure" is often the most important part of a design.

AI can also be the *reader*. A doc PR may be cross-referenced by AI against existing design docs for consistency. That is not outsourcing judgment. It is the same interposition pattern the whole project runs on: AI proposes ("this contradicts `design-thread-scope.md` §5"), the human decides whether the contradiction is real.

---

## What this is not

- **Not a bug tracker.** Users file issues. Forks are for plans.
- **Not a code review substitute.** A fork with code still gets its code reviewed. The fork doc is the *reason*; the code is downstream.
- **Not the surface for aligning a doc with the current shape.** Sharpening an existing design doc is a normal PR to `docs/`. A fork is for disagreeing with the shape, not for tidying it.
- **Not a plan to be merged as code.** A design-only fork is a plan the upstream *may* rebuild in its own idiom. It is not a promise to implement your version. If it graduates to `docs/feats/`, that means the *idea* earned a place, not necessarily the *implementation*.

---

## Promotion

A fork graduates when it stops being a fork. That is a human decision and it is not rushed.

When it happens, `docs/forks/your-fork/` becomes `docs/feats/your-fork/`. The content moves intact. No rewriting, no reformatting, no "adjusting it to fit." The argument that earned the move is the argument that ships.

If a fork never graduates, it still lives in `docs/forks/`. That is not failure. A declared, legible fork is a better contribution to the project's thinking than an undeclared one, whether or not it ever becomes the mainline.