# Design: The Terminal

**Roadmap track:** Phase 3.y integrated-terminal proposal; earlier terminal tiers are historical. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Design locked. External ships in 2.4.4. Integrated ships
in Phase 3.y.

**Applies to:** Phase 2.4.4 (external), Phase 3.y (integrated).

**Governs:** What "a terminal" means in Craidd, what we build, and
what we deliberately do not.

---

## The decision

Craidd offers three things, in this order of arrival:

1. Command box (Phase 2.4.3). A one-line input in the Output panel.
   Not a terminal.
2. External terminal (Phase 2.4.4). Ctrl+Shift+` opens the user's
   terminal emulator in the project folder.
3. Integrated terminal (Phase 3.y). A real terminal, in the bottom
   panel, rendered by Craidd. Uses xterm.js and a `craidd-pty-host`
   subprocess.

The first two are small. The third is a Phase, not a script, and it
is built last, after LSP and DAP have proven the containment
foundation on long-running streaming processes.

---

## Why we don't reparent a native terminal

The obvious clever approach: spawn `kitty` or `gnome-terminal` with
`XReparentWindow()`, so its window renders inside Craidd's bottom
panel. Crash isolation for free. No renderer to write.

It looks wrong.

Every native terminal emulator has its own headerbar, its own padding,
its own fonts, its own scrollbars, its own titlebar buttons. When
reparented into a Craidd panel, it looks like a window-in-a-window,
because it is one. Gedit with a terminal plugin, Bluefish, older
Eclipse: every IDE that tried this has the same result.

The constraint that kills it: the terminal must look like Craidd.
Same font rendering, same colour theme, same padding, same scrollbar.
Any native emulator carries its own look. So we render it ourselves.

Wayland compounds the problem. Window reparenting has no clean
equivalent. On GNOME Wayland, the default on Ubuntu 24.04+ and Fedora
40+, this path largely does not work at all.

We do not pursue it. The command box and external terminal cover the
gap.

---

## Why we don't write our own VT parser

The opposite temptation: write a full terminal emulator from scratch.
Escape sequences, grid, cursor, alt-screen, mouse tracking, DEC
private modes. It is a 10,000-line project with bugs at every corner.

Nobody writes their own VT parser in 2026. The right answer is to use
the one that already exists and is battle-tested.

xterm.js. It is what VS Code ships, what Hyper ships, what
JupyterLab ships, what every cloud IDE ships. Apache-2.0. Its
escape-sequence handling is correct because four million daily users
have exercised it. It is the right renderer.

The alternative, `alacritty_terminal` as the parser with our own
renderer, is viable and was considered. It trades a well-tested
renderer for a well-tested parser plus our own rendering. That is
more code, not less. xterm.js wins on "use what exists."

---

## Why xterm.js does not imply VS Code's bugs

VS Code's "terminal eats all the RAM" issue is real. It is also not
xterm.js's fault. The bug lives in the surrounding architecture:

- Unbounded scrollback, 100,000 lines per terminal, twenty terminals.
- Node-pty buffering in V8's heap without backpressure.
- Chromium's compositor queue growing under sustained output.
- The event loop backing up under a 1000-plugin install.

None of these are xterm.js. They are all "the surrounding code did not
bound itself." We bound it. Six rules:

### The six rules

1. Scrollback capped at 5000 lines. Not configurable above 10,000.
   5000 lines is roughly 120 KB per terminal. Twenty terminals is
   2.4 MB. VS Code's default is 1000, but users raise it to 100,000.
   We do not let them.

2. Bounded ring buffer between PTY and IDE. 1 MB fixed size. When
   the shell writes faster than we consume, we stop reading from the
   PTY. The kernel's own PTY buffer fills. The shell blocks in
   `write()`. This is what a real terminal does. VS Code does not do
   this; node-pty reads as fast as it can and buffers in V8.

3. One renderer mode: canvas. No auto-selection, no WebGL, no DOM.
   Canvas is predictable: GPU-accelerated by WebKitGTK's compositor,
   no separate WebGL context, no DOM explosion.

4. Terminal runs in a child webview. A separate WebKitGTK process. A
   crash in the terminal renderer does not touch the main UI. Tauri's
   `WebviewBuilder` supports this; Electron's model does not.

5. Shell runs in a `craidd-pty-host` subprocess. A separate OS
   process. Its crash is a dead socket, not a dead IDE.

6. Memory watchdog. Each terminal reports its usage. Over 100 MB, the
   IDE shows a banner: "Terminal 2 is using 120 MB (limit 100 MB).
   [Trim scrollback] [Kill terminal]." Not silent. The user decides.

With these rules, xterm.js cannot OOM the IDE. The buffer sizes are
fixed. The PTY cannot outrun us. The webview crash is contained. The
subprocess crash is contained.

On an 8 GB laptop: ten terminals is roughly 160 MB total. That is
the ceiling. It does not grow.

### What we do not use

xterm.js ships addons: `attachAddon`, `fitAddon`, and others. We do
not use them. They are convenience wrappers where VS Code's specific
behaviours live. We write the resize and data plumbing ourselves,
against xterm.js's documented primitives: `resize()`, `write()`,
`onData()`.

The renderer is correct. The plumbing is where the discipline goes.

---

## The three-tier design

### Tier 1 — Command box (ships 2.4.3)

One line, one command, output into the panel above. Runs
`sh -c "<command>"` in the solution root. Uses the existing
`RunnerManager`. No PTY, no escape sequences, no `bash -i`. History
with arrow keys, in-memory for the session.

This is what "run a command in this project" means 90% of the time.
It ships early because it is ten lines of Rust and twenty of
TypeScript.

### Tier 2 — External terminal (ships 2.4.4)

Ctrl+Shift+` spawns the user's terminal in the solution root.

Detection: `$TERMINAL` env var, then `x-terminal-emulator`, the
Debian/Ubuntu alternatives system, then the first of `alacritty`,
`kitty`, `wezterm`, `foot`, `gnome-terminal`, `konsole`,
`xfce4-terminal`, `xterm` found on `PATH`.

Each terminal has its own `--working-directory` flag or equivalent.
A small per-emulator adapter table.

Configurable in preferences: "Preferred external terminal: auto".

This is what "I want my own terminal" means. Ships early because it
is twenty lines of Rust and a menu item.

### Tier 3 — Integrated terminal (Phase 3.y)

A real terminal in the bottom panel, rendered by Craidd. This is the
phase, not the script.

Architecture:

craidd-studio
  main webview (React UI, editor, panels)
  terminal webview (child, one per terminal)
        |
        | IPC (Tauri commands + events)
        |
  craidd-pty-host (one per terminal, Rust binary)
        xterm.js renderer state (grid, cursor, alt-screen)
        $SHELL (PTY child)

The pty-host spawns the user's `$SHELL` in a PTY, reads bytes, feeds
them through its own copy of the terminal state, and sends grid
deltas to the IDE, not raw escape sequences. Only changed cells go
over the wire. Bandwidth is capped at grid-size per frame regardless
of how fast the shell writes.

The IDE forwards deltas to the terminal webview, which renders them
onto a canvas. User keystrokes go the other way.

Why grid deltas. A shell flooding 1 GB/sec still produces a grid of
fixed size. The IDE never holds the raw bytes. Memory does not move.
This is the containment guarantee made structural.

Test case. The acceptance test for the integrated terminal is:

docker run -d alpine sh -c 'yes'

The container prints "y" forever. The terminal must stay alive.
Memory must not grow past a fixed ceiling. The user must be able to
Ctrl+C, scroll, and close the tab. Craidd must survive.

If Craidd survives that, the terminal cannot kill the IDE.

---

## Where the terminal lives

Bottom panel, Terminal tab. Multiple terminals as tabs within that
panel. Each terminal persists per solution for the session. Close the
solution, the terminals close. This is not tmux; this is not
persistent sessions; this is "a shell, in this window, for this
solution."

---

## What this defers

- Remote terminals. Not now.
- Session persistence. Not now.
- Split terminals within the panel. Not now.
- Terminal search and copy modes. Not now.

None of these are foreclosed. All are downstream of a working Tier 3.

---

## The rule that governs everything

The terminal must look like Craidd, behave like a real terminal, and
be unable to take down the IDE. Renderer from xterm.js, containment
from us.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a design.*
