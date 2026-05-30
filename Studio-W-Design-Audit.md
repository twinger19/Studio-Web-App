# Studio W — Design & UX Audit

**Reviewer:** Lead Product Designer / Principal UX Architect
**Benchmarks:** Linear · Attio · Cron / Notion Calendar · Raycast
**Method:** Audit grounded in the live codebase (`styles.css`, `app.js`) and rendered screenshots (dark + light), not a generic rubric.

---

## Executive summary

Studio W is **not** a dated app. It is a *confident, well-executed Apple "iOS 26 Liquid Glass" interface* — your own stylesheet header says so. Translucent surfaces (`--surf:rgba(28,28,30,.72)`), heavy `saturate(1.8) blur(30px)`, SF Pro, iOS System Blue, continuous-curve radii. As an Apple consumer aesthetic, it's a B+.

But you asked to be measured against **Linear, Attio, and Raycast** — and that is a *different design religion*. Those tools are flat, dense, near-black, hairline-bordered, and monochrome to the point of austerity. Liquid Glass and the Linear school pull in opposite directions: gloss vs. discipline, translucency vs. density, polychrome vs. restraint.

> **The core finding: your execution is good, but your aesthetic target is internally contradictory.** "Glassmorphism" (your earlier direction) and "Linear/Raycast" (your benchmark here) cannot both be the goal. To hit elite-tier-2026 as those tools define it, you must **trade gloss for discipline and air for density.**

**Overall grade: B–** — beautiful, but consumer-flavored where it wants to be operator-grade.

| Dimension | Grade | One-line verdict |
|---|---|---|
| Dark-as-default & accent discipline | **C+** | True black is too harsh; 8 vivid member colors fight the accent. |
| Information density & bento | **C** | Generous padding + 14px radii read "iOS app," not "control surface." No overview/bento home. |
| Depth & translucency | **B–** | Glass is well-made but it's the wrong era for this benchmark; dark shadows are invisible on `#000`. |
| Typography hierarchy | **B+** | Strong SF stack and scale; base size and muted-text contrast can be tightened. |
| Cognitive load / disclosure | **B–** | Tabs and the sheet help; cards and panels still show everything at once. |
| Contextual navigation | **B** | ⌘K, quick-add, and drag-drop are genuinely strong. The modal sheet is the weak link. |
| Ambient intelligence | **C** | The bones exist (AI chat, task templates) but the app is still reactive. |
| Team & workload order | **C+** | Counts only. No live workload visualization; clutter risk at scale. |

---

## 1. Modern UI & Visual Styling Critique

### 1a. The "Dark-as-Default" & Accent System — **C+**

**What you have.** Dark mode sets `--bg:#000000` (true black), `--surf:rgba(28,28,30,.72)`, accent `--acc:#0A84FF` (iOS blue). Members are colored from an **8-hue palette**: `#6376DA, #E88B6D, #6DB8E8, #9B6DE8, #50C08A, #E8CC5A, #E86D8B, #5AC8E8` — periwinkle, coral, sky, purple, mint, yellow, pink, cyan.

**The honest critique.**

- **True black `#000` is *more* extreme than the benchmark, not less.** Linear uses ~`#08090A`, Raycast a warm near-black; nobody elite uses pure black. On OLED it smears during scroll, and every hairline border has to fight maximum contrast. **Near-black > black.** Move the base to ~`#0B0B0C` and build surfaces *up* from there in 3–4 discrete steps.
- **Accent discipline is broken by the member palette.** Linear's entire UI is purple-on-grey. Attio is blue-on-white. You have **iOS blue *plus* eight saturated member hues** competing in the sidebar, on every board column dot, and in calendar chips. The eye has no anchor. This is the single biggest "this isn't Linear" tell. The accent should be the *only* saturated color in the chrome; identity colors should be desaturated to near-grey or replaced with **monogram avatars** (initials on a neutral chip), with hue reserved for genuine status (overdue/at-risk).
- **Status colors are fine** (`--ok/--red/--warn` are iOS system) — but they currently sit at the same saturation as member colors, so "urgent red" doesn't pop above "Pierre coral." Lowering identity saturation automatically gives status its priority back.

**Fix direction:** one accent, near-black base, monochrome identity, hue only for state.

### 1b. Information Density & "Bento Box" Layouts — **C**

**What you have.** A horizontal, per-member **kanban board** of brand sections and project cards; a project **sheet** with a tab row; a fixed sidebar rail. Card padding is generous, radii are `--r:14px`/`16px`, board gutters are comfortable.

**The honest critique.**

- **It reads like an iOS app, not an operator console.** Linear/Attio fit 2–3× more on screen at the same zoom because they use **~8px radii, hairline dividers instead of shadowed cards, and 28–36px row heights.** Your 14–16px radii + soft shadows create "floating pill" density, which is friendly but low-information.
- **There is no bento/overview surface.** The landing view is the board itself. The benchmark pattern — and the thing that would make Studio W feel like a "Life OS" — is a **Home/Today bento grid**: modular, uniform-gutter tiles (Today's tasks · This week's calendar · At-risk projects · Team load · Quick capture). You have all the data (`computeAlerts`, scope counts, per-member rollups); you just don't compose it into a dashboard.
- **Gutters aren't yet on a strict scale.** Premium grids commit to a token scale (4/8/12/16/24). You have ad-hoc paddings (`13px 14px`, `12px 14px`, `16px 18px`). Pick a 4px base scale and snap everything to it.

**Fix direction:** tighten radii to 8–10px, replace shadowed cards with hairline-bordered rows in dense views, and build a real bento **Home**.

### 1c. Depth & Translucency (Adaptive Transparency) — **B–**

**What you have.** Heavy, genuine glass: `--glass-blur:saturate(1.8) blur(30px)`, translucent surfaces at `.72` alpha, specular top-edge highlights, and a soft dark shadow `--sh:0 8px 32px rgba(0,0,0,.55)`.

**The honest critique.**

- **The glass is well-built — but it's the 2021–2023 trend, not the 2026 benchmark.** Linear and Raycast are deliberately *flat*: solid near-black panels separated by 1px borders and tiny inner highlights. Translucency in those tools is reserved for **transient overlays only** (command palette, menus) — never the working surface. Your board cards and panels being translucent is precisely what makes it feel "Apple app" rather than "Linear."
- **Your big dark shadow is doing nothing on `#000`.** A `32px/.55` drop shadow is invisible against true black; it only muddies. On dark surfaces, **hierarchy comes from a lighter surface + a 1px top highlight (`inset 0 1px 0 rgba(255,255,255,.06)`)**, not from drop shadows.

**Fix direction:** keep glass for ⌘K, modals, and menus; make the board, sidebar, and detail panels **solid near-black with hairline borders**. Replace dark drop-shadows with surface-step + inset highlight.

### 1d. Typography Hierarchy — **B+**

**What you have.** SF Pro Text/Display split, display headings with `letter-spacing:-.025em`, project title at `24px/700/-.4px`, body `14px`, muted `--tm:#98989D`. This is your strongest dimension.

**The honest critique.**

- **Base size is a touch large for a dense tool.** 14px is iOS-comfortable; Linear/Attio run ~13px body with 12px metadata. Dropping to 13px base instantly buys density without redesign.
- **Muted text contrast is slightly soft.** `#98989D` on near-black is fine for labels but gets used for content too; introduce a **two-tier muted system** (`--tm` for labels ~`#8A8A8E`, `--txt-2` for secondary content ~`#B6B6BB`) so hierarchy reads at a glance.
- **Weights are good; tracking is good.** Keep the display/text split — that's a premium detail many apps skip.

**Fix direction:** 13px base, two-tier secondary text, keep the SF display/text split.

---

## 2. Advanced UX & Ambient Flow

### 2a. Cognitive Load & Progressive Disclosure — **B–**

- **The project card shows all meta, always** (`✓ x/y`, overdue, next due, progress bar). In the benchmark, secondary meta **dissolves until hover/selection**; the resting state shows name + a single status signal. Recommend: resting card = name + one status dot; reveal counts/bar on hover or in the open sheet.
- **The detail sheet is good progressive disclosure** (tabs gate Notes/Tasks/Meetings/Travel/Links) — this is the right instinct. But the **tab row presents five peers with equal weight**; if Notes is now the default and primary, let it own the space and demote the rest to a lighter, smaller control.
- **The sidebar shows the full member→brand→project tree expanded by default.** Your new Expand/Collapse-all helps. Push further: **collapse to the active context** — when a project is open, the tree should quietly focus that branch, not display everyone's everything.

### 2b. Contextual Navigation — **B**

- **Genuine strengths — say yes to these and lean in:** ⌘K command bar with `@name`/`/today` parsing, the quick-capture FAB, drag-and-drop board reordering, and a context-aware AI chat. This is *exactly* the Raycast/Linear keyboard-first DNA. Most of your "premium" credit lives here.
- **The weak link is the modal sheet.** Opening a project throws a full overlay (`projSheetOv`, body scroll locked). It's heavy for something you do constantly, and it's a soft dead-end: to compare two projects you must close and reopen. Benchmark behavior is **inline navigation** (the detail replaces the main pane, the board stays one keystroke away) or a **peek/expand** pattern. At minimum: add `←/→` to move between projects *inside* the sheet, and `Esc`-to-board (you have Esc; advertise it).
- **Cross-surface flow has small dead-ends:** moving from a calendar event to the underlying task, or from a note mention to a task, isn't always one click. Audit every "view" for a path back to *create/act*, not just *read*.

---

## 3. Core Functionality & Team Order

### 3a. Ambient Intelligence — **C (highest upside)**

You're reactive today; the scaffolding for predictive is already in the repo.

- **You already ship two ambient seeds:** "Generate Product Development Tasks" (a template engine) and a Gemini chat with full project context. Most apps don't have this. The gap is that they're **opt-in buttons**, not ambient.
- **Move from buttons to suggestions.** Examples grounded in your data model: when a project has a start/end date but no tasks, *offer* a backdated milestone plan; when several tasks share a due week, *surface* "heavy week ahead"; when a note contains a date or a name, *offer* to create a task/assignee inline; auto-draft a **one-line project summary** from its tasks/notes (you just removed the manual Summary field — replace it with a *generated* status line that needs no upkeep).
- **Smart timeline summaries:** a weekly "here's what moved / what's at risk / what's due" digest, generated from state, shown on the Home bento and optionally emailed.

### 3b. Team & Workload Optimization — **C+**

- **Today you show counts** (project count, open-task count per column). That's order-by-tally, which becomes spreadsheet-y the moment you have 6 members × 4 brands.
- **Visualize load, don't list it.** A **workload strip** per member (a thin bar: capacity vs. open/overdue, colored only by state) turns the board header into an at-a-glance heat read. Attio/Linear lean on exactly this kind of compact, monochrome-with-status-accent density.
- **Status as a first-class signal, not a count.** Each project needs a derived state (On track / At risk / Blocked / Done) computed from due dates + completion, rendered as **one dot** — so the board scans by color-of-state, not by reading numbers. This is also what finally gives your accent/identity discipline (1a) somewhere meaningful to spend color.
- **Order across streams:** introduce a saved-view concept (you have scopes — Today/Overdue/Week/All). Promote those into **persistent, shareable filtered views** ("My overdue," "Pierre's week"), the way Linear's views anchor team focus.

---

## The Professional Recommendation Report

### 1 · Quick Wins — low effort, high impact (styling discipline)

These are mostly token edits in `styles.css` and would visibly "Linear-ify" the app in an afternoon.

1. **Near-black, not black.** Dark `--bg:#000000` → `#0B0B0C`; rebuild surfaces in steps (`#141416`, `#1B1B1E`). Kills OLED smear and harsh borders.
2. **Tighten the geometry.** `--r:14px` → `10px`, `--rs:10px` → `8px`; card/stat radii `16px` → `12px`. Instantly less "iOS," more "console."
3. **Kill the dead shadow on dark.** Replace `--sh` in dark with `0 0 0 1px var(--bdr)` + `inset 0 1px 0 rgba(255,255,255,.05)`. Hierarchy from surface-step, not blur.
4. **Desaturate identity.** Drop the 8 member hues to ~40–50% saturation *or* switch to neutral monogram avatars; reserve full saturation for status only. This is the highest-impact single change for "discipline."
5. **Base type to 13px**, add a second secondary-text token for content vs. labels.
6. **Snap spacing to a 4px scale** (replace `13px 14px`-style ad-hoc paddings). Uniform gutters are 70% of the "bento" look.
7. **De-glass the working surfaces:** board cards, sidebar, and detail panel → solid; keep blur only on ⌘K, modals, menus.

### 2 · UX Enhancements — medium effort (structure & flow)

1. **Build a bento Home/Today.** Modular tiles (Today · Week calendar · At-risk · Team load · Quick capture) on a strict grid — this is the missing "Life OS" front door and uses data you already compute.
2. **Replace the modal sheet with inline detail** (or add `←/→` between projects + visible `Esc` to board). Removes the constant overlay weight and the compare-two-projects dead-end.
3. **Progressive cards.** Resting state = name + one status dot; reveal meta/progress on hover or in the open view.
4. **Derived project status** (On track / At risk / Blocked / Done) as a single colored dot across board, sidebar, and calendar — your color budget, finally well spent.
5. **Persistent saved views** built on your existing scopes (per-member, per-state), pinnable in the sidebar.
6. **Context-focus the tree:** auto-collapse to the active branch when a project is open.

### 3 · Strategic Feature Proposals — high effort (elite-tier)

1. **Ambient status line.** Replace the deleted manual Summary with an *auto-generated* one-sentence project status (from tasks/dates/notes), refreshed on change — zero upkeep, always current.
2. **Predictive planning.** When intent is detectable (dates set, brand chosen, note written), proactively *offer* milestone plans, "heavy week" warnings, and note→task extraction inline.
3. **Workload intelligence.** Per-member capacity model + heat strip; a weekly auto-digest ("moved / at-risk / due") on Home and via email.
4. **Command-first everything.** You already have ⌘K — extend it to navigation and mutation (jump to any project, reassign, reschedule, create view) so power users never touch the mouse. This is the Raycast move.
5. **Calendar as a peer surface** (Cron/Notion-grade): drag tasks onto days, time-block, and reconcile project ranges with real events — not a read-only month grid.

---

## Closing note

Studio W's problem isn't quality — it's *identity*. It's a polished Apple consumer app wearing the brief of an operator's control surface. The work to reach Linear/Attio/Raycast tier is **subtractive**: less hue, less gloss, less air, fewer always-on details — and then a few additive bets (bento Home, derived status, ambient summaries) that turn the data you already track into foresight. Do the seven Quick Wins first; they'll make the app *look* like it belongs in that company by the end of the day, and they'll make the harder structural calls easier to judge.
