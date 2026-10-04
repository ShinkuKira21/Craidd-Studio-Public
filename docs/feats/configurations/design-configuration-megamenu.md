# Visual design: Configuration megamenu

**Status:** Proposal for review, 19 September 2026. No UI code changed.
**Companion:** [Project configurations and NuGet](design-project-configurations-and-nuget.md).

## The idea

The project chip opens **one connected, two-column dropdown**. The left
column answers “which project?” The right column answers “what can this
project do?” Moving through the left column updates the right column in
place. There is no detached submenu to chase with the mouse.

The main Build and Run buttons use the selected project. Their existing
chevrons remain the fast way to run another project's action once. The
Profile chip stays outside the menu because Debug/Release is a shared build
choice, not another project row.

## Closed toolbar

```text
┌───────────────────────────────────────────────────────────────────────────┐
│  🔨⌄   [ ASP.NET API  ▾ ]   [ Profile  Release ▾ ]   ▶⌄   ■   🐛⌄       │
└───────────────────────────────────────────────────────────────────────────┘
        └─ active project ─┘     └─ build variant ─┘
```

The chip says `ASP.NET API`. It does not alternate between `ASP.NET API:
dotnet build` and `ASP.NET API: dotnet run`. Both actions belong to this
one project configuration.

## Open megamenu: four projects, two actions

```text
        [ ASP.NET API  ▴ ]
        ┌────────────────────────────────────────────────────────────────┐
        │ PROJECT CONFIGURATIONS                                         │
        ├──────────────────────────────┬─────────────────────────────────┤
        │ INFERRED                     │ ASP.NET API                     │
        │                              │ .NET 10 · C# · Inferred         │
        │   CSharp Smoke            ›  │                                 │
        │   Console Main            ›  │  BUILD                          │
        │   Desktop GUI             ›  │  dotnet build                   │
        │ ▌ ASP.NET API           ✓ ›  │                                 │
        │                              │  RUN                            │
        │                              │  dotnet run                     │
        │                              │                                 │
        │                              │  Debug available when an       │
        │                              │  adapter is configured.         │
        ├──────────────────────────────┴─────────────────────────────────┤
        │ Add / Edit Configurations…                                    │
        └────────────────────────────────────────────────────────────────┘
```

This is the whole menu for the C# example solution: **four project rows on
the left, two available actions on the right**. The Debug note is secondary
text rather than a disabled third action row. The selected project gets a
slim blue rail and a check mark. Hover gets a quieter background.

## Hovering a different project

```text
        ┌──────────────────────────────┬─────────────────────────────────┐
        │ INFERRED                     │ Desktop GUI                     │
        │                              │ Avalonia · C# · Inferred        │
        │   CSharp Smoke            ›  │                                 │
        │   Console Main            ›  │  BUILD                          │
        │ ░ Desktop GUI             ›  │  dotnet build                   │
        │ ▌ ASP.NET API           ✓ ›  │                                 │
        │                              │  RUN                            │
        │                              │  dotnet run                     │
        └──────────────────────────────┴─────────────────────────────────┘
```

The grey `Desktop GUI` row is only **previewed**. The blue rail/check still
marks `ASP.NET API` as selected. Hover never changes what the toolbar buttons
will run. Click or Enter on a project row selects it for Build and Run and
closes the menu.

The right column is a command preview, not a second set of launch buttons.
That keeps the action chevrons useful: their rows execute a one-off Build or
Run without changing the selected project. The megamenu selects context; the
buttons execute work.

For the four-project case, aim for a panel around **560 px wide and under
300 px tall**: roughly 215 px for project names and 345 px for the preview.
Use compact 34 px rows, one quiet divider, and the existing zinc surfaces.
The blue selection rail is the main accent; repeated icons and large cards
would make the panel feel chunky again.

## When a project has custom variants

```text
        ┌──────────────────────────────┬─────────────────────────────────┐
        │ PROJECTS                     │ ASP.NET API                     │
        │   ASP.NET API    Custom   ›  │                                 │
        │   Desktop GUI             ›  │  BUILD  dotnet build            │
        │                              │  RUN    Local · dotnet run      │
        │                              │         Staging · custom command│
        └──────────────────────────────┴─────────────────────────────────┘
```

A user override replaces the equivalent inferred item in this picker; it
does not add a second `ASP.NET API` row. Named variants can appear in the
right column. Their default is shown with a check mark once variant editing
is implemented. `Add / Edit Configurations…` opens the full editor to change
commands or defaults. The megamenu stays a quick picker and preview.

## Interaction details

| Input | Result |
| --- | --- |
| Click project chip | Open or close the megamenu. |
| Hover a project | Preview its actions on the right; keep the current selection. |
| Click a project | Make it the shared Build/Run default and close. |
| Arrow Up/Down | Move the preview and keyboard focus through project rows. |
| Enter or Space | Select the focused project and close. |
| Escape or click outside | Close without changing the selection. |
| Build/Run chevron | Execute another project's action once. |
| Add / Edit Configurations | Open the writable project configuration dialog. |

Use a short hover delay so crossing the panel does not flash through four
project previews. Focus and click must work without hover on ChromeOS touch
screens. Keep the panel attached to the chip, within the window bounds, and
scroll only the project list when there are many projects. Show search only
when the list grows enough to need it.

### Narrow window

At a width where two columns would crush the text, keep one dropdown and
stack the selected project's two action previews below the project list.
Limit the panel height to the viewport and scroll inside it. The same click
and keyboard behavior applies; there is no hover-only route to an action.

## What changes from today

The current toolbar renders every `ConfigEntry` as a primary row. C# creates
separate inferred Build and Run entries, giving eight rows for four projects.
The first implementation can group those existing entries for display and
keep their commands intact. A later model can store one project configuration
with Build/Run/Debug action slots, as described in the companion design.
