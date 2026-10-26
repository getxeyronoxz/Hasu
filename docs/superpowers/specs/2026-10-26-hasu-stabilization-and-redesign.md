# Hasu 1.6 — Stabilization and Redesign Design

## Goal
Make Hasu feel lighter, faster, and more reliable while fixing the desktop companion and
modernizing the UI. The Python desktop-agent sidecar should be replaced with a faster,
lighter native sidecar. The project should be tracked in public Git/GitHub with a proper license.

## Decisions made so far
- Git repository initialized (branch `main`).
- License: MIT (see `LICENSE`).
- Public GitHub repo: https://github.com/getxeyronoxz/Hasu
- Initial baseline commit created and pushed.

## Problem statement
1. **Desktop companion does not sit.** "Sit on taskbar/window" behaviour fails or is
   unavailable in some cases; only whole movable window bounds are used.
2. **Heavy/slow.** The Python FastAPI sidecar plus pywinauto/pywin32 startup and per-call
   subprocess/HTTP overhead makes simple desktop actions feel slow.
3. **Too many low-value features.** Many tools are worth consolidating or removing.
4. **UI/UX not premium.** Layout is terminal/mono heavy, low feedback, inconsistent spacing,
   and lacks a clear visual hierarchy.
5. **No version control / release discipline.** Until now no Git baseline existed; builds
   and installers were loose.

## Scope for this round
A. Fix the highest-value desktop companion issue (window sitting as the anchor bug first).
B. Reduce and speed user-facing behaviour: fewer, faster, clearly labelled actions.
C. Establish one stable public release path (`dist:public`) and CI smoke tests.
D. Begin (not necessarily finish) the sidecar replacement behind a clean abstraction so
   Python can be removed without changing the public UI/tool contract.
E. Refresh the web UI visual language and make the main app, settings, character studio,
   and companion screen consistent.

## Non-goals
- Rewriting every Python tool at once (phased port).
- Bundling any 3D character model (still user-imported).
- Dropping the Gemini Live voice flow or memory engine wholesale.

## Architecture direction

### Desktop agent replacement
Recommended: **.NET 10 console service with NativeAOT/trimming publish to a single exe**
- First-class Windows APIs: `System.Windows.Automation`, Win32 window enumeration, WMI metrics.
- Keep the existing localhost HTTP JSON contract (`GET /health`, `POST /execute`) so Node
  and Electron call it unchanged.
- Publish as one self-contained executable, spawned and supervised by Hasu's Node backend.
- Port only essential tools first (Tier 1), keep compatibility adapters later.
- Alternative: Rust if binary size is the priority; rejected for now because UI Automation
  and windowing code is more error-prone and slower to validate in this repo.

### Tier 1 (must port first)
- open/close application
- open folders and known paths
- list/select window
- minimize/maximize/close focused window
- screenshot full screen
- system info (CPU/RAM/disk)
- open website/search
- clipboard get/set
- volume up/down/mute/select

### Tier 2 later
- OCR / screen text reading
- file read/write/move/delete (scoped safe roots)
- deeper window targeting, browser control
- GPU/temp sensors, phone extras, coding helpers

### UI direction
- Move from mono/cyber overlay to a calm editorial system:
  readable sans body, mono only for state badges/numbers.
- Single accent (cyan) plus neutral greys; progress shimmer not noise.
- 8-pt spacing grid; cards with 12px radii; max 1 primary action per card.
- Settings as sticky navigation with clearly grouped sections.
- Desktop companion unchanged 3D model, but better HUD overlay and softer shadows.
- Accessibility: visible focus, contrast AA, `prefers-reduced-motion` respected.
- Keep the existing auto graphics downgrade and emergency kill switch.
- Add loading/empty/error states for tools and media.

### Repo hygiene
- All changes must go through commits + push; release builds go under `release/` but are
  gitignored; source only.
- Tests run before shipping (`npm run lint`, `test:agent`, `test:python`, companion checks).

## Known issues to investigate (first-pass)
1. `electron/companion.cjs` window/anchor detection can produce no usable `window` surface
   in `surfaces()` because `probeX` or window bounds filter top candidate out.
2. Python sidecar startup commands are hard-coded to external Python paths in docs, but
   `run_agent.py` / server configuration may differ.
3. No automated check catches missing release artefacts or desktop companion startup.

## Proposed work sequence
1. Baseline repo + license (done).
2. Write companion reproduction (logs + current `companion.log` behaviour).
3. Patch companion surface detection (keep changes tiny, test against real desktop).
4. Add lightweight performance baseline (sidecar cold start, command roundtrip).
5. Implement the .NET 10 sidecar skeleton (Tier 1) behind same API.
6. Split UI into shared design tokens and redesign major screens.
7. Run test matrix: unit, manual companion, installer smoke.
8. Tag `1.6.0`, push, build `dist:public`.

## Risks
- COM/UI Automation in .NET may behave differently under packaged/runtime elevation.
- Removing all Python breaks users who run from source; mitigated by parallel sidecar phase.
- Electron/window managers can regress if surface detection changes blindly.

## Open questions for the project owner
1. Sidecar language: **.NET 10** (confirmed). Rust rejected for this phase due to Windows UI Automation porting cost.
2. Is the companion issue on a specific Windows build (multi-monitor/taskbar auto-hide)?
3. Should the public repo allow external PRs, or keep direct-push workflow?