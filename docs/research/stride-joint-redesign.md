# Research: the stride ↔ ledger joint — header anatomy and the direction handover

Feeds the reaction on [#12](https://github.com/asmundwien/roadmap/issues/12). The stride prototype
(`prototype/stride`) made the project the unit of UI: a single-open accordion of a project's maps in
journey order — earliest-closed stride at the top, the active map open at the bottom — with one rail
threaded through the collapsed headers so the whole screen reads as one continuous roadmap. Two
things don't work at the joint where a stride opens:

1. **The header competes with what it reveals.** The collapsed stride is a title line; the open
   state embeds the unified ledger (`src/views/map/ledger.tsx`), whose topmost element is the
   `the destination` caption plus destination text — which visually reads like *another* title,
   directly under the header that just opened.
2. **Direction of travel conflicts.** The accordion travels downward (oldest first, live edge at
   the bottom), but the embedded ledger travels upward (ground covered at its bottom, destination
   at its top). A rail cannot flow seamlessly through an open stride while the two halves disagree
   about which way is forward.

Question: what existing, well-documented patterns govern (a) the relationship between a collapsed
header and the content it expands into, (b) carrying marks at two scales on one line, and (c)
reconciling a vertical oldest-first list with embedded content that has its own internal direction?

**Verdict up front: the header and the destination block are the same element drawn twice, and
every pattern surveyed says to collapse them into one.** The disclosure literature is unanimous
that the header is the *label for* the panel — a panel that re-announces its own label is a
duplicated heading, which is exactly what the current joint renders. Material's container transform
gives the cleanest mental model: the collapsed thing and the open thing are one container whose
contents swap, not two stacked things. On direction, the precedents split cleanly by genre: *list*
genres put newest first (git log, changelogs, release pages), *chronicle* genres put the live edge
at the bottom (chat, email threads, issue timelines) — and the accordion, journey-ordered with the
active map at the foot, is a chronicle. Transit practice adds the decisive detail: a line diagram
is always redrawn so the reader reads forward — TfL mirrors and re-anchors per platform rather
than ever tolerating a direction flip mid-artifact. The honest conclusion is that the embedded
ledger should flip to read downward inside the chronicle, or the joint must be drawn as an explicit
scale-change (an interchange, not a seam) so that no single line claims continuity through it.

Claims are cited inline. Paragraphs that are my own synthesis rather than a sourced claim are
marked **[synthesis]**.

---

## 0. The joint as built, precisely

Baseline **[synthesis, from reading the source]**. The ledger's vertical frame, top to bottom, is:
destination (⚑ node + `the destination` caption + up-to-4-line destination text), fog, charted
ahead, ground covered (`src/views/map/geometry.ts`, `buildLedger`). The trunk runs through all of
it — dashed ahead of HEAD, solid behind — so the traveller reads as walking *upward* toward the
flag. The stride prototype (`src/prototypes/stride/`) stacks strides oldest-first *downward* and
embeds this ledger unchanged inside the open stride. So an open active map renders, top to bottom:
older strides → **stride header** → **destination caption + text** (the second title) → fog →
ahead → covered — and at the top edge of the open panel, "up" silently changes meaning from
"the future of this map" to "the deeper past of the project." Both problems are visible in one
screenshot.

---

## 1. The structural contract: a header is the label for its panel

The WAI-ARIA Authoring Practices define the accordion's two parts with a precision worth quoting.
The accordion header is the "Label for or thumbnail representing a section of content that also
serves as a control for showing, and in some implementations, hiding the section of content"; the
accordion panel is the "Section of content associated with an accordion header"
([APG accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/)). Structurally, the
header's title is "contained in an element with role `button`," wrapped in an element with role
`heading` at an `aria-level` matching the page's information architecture, with `aria-expanded`
and `aria-controls` binding it to the panel (same source). The simpler
[disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) has the identical
skeleton: "a disclosure button and a section of content whose visibility is controlled by the
button."

Two consequences follow directly **[synthesis]**:

- The header *is the heading* of the open content. In APG terms the current joint renders two
  headings for one section — the stride header (real heading) and the destination caption+text
  (styled like a heading). One of them is structurally false.
- The header never disappears on expand. It remains the visible, focusable label above the panel
  in every APG example and every implementation surveyed below. So the redesign cannot be "hide
  the header when open" — it must be "make the header and the destination stop being two things."

**What this means for the ledger:** whatever the visual answer, the accessible structure is fixed:
one `heading`+`button` per stride, the ledger as its labelled panel. The destination text either
*is* that heading's text, or is demoted to non-heading body content inside the panel — there is no
third option in which both look like titles.

## 2. What the summary row keeps, and what it hands off

Every major design system's expansion component agrees on the anatomy and, more usefully, on the
division of labour between the two states:

- **IBM Carbon**: the header "contains the section title and is control for revealing the panel";
  the icon "indicates if the panel is open or closed"; the panel is "the section of content
  associated with an accordion header." The title "should be as brief as possible while still
  being clear and descriptive," because it "gives the user a high level overview of the content
  allowing the user to decide which sections to read"
  ([Carbon accordion usage](https://carbondesignsystem.com/components/accordion/usage/)).
- **Angular Material** (the living descendant of Material's expansion panel): the header "shows a
  summary of the panel content and acts as the control for expanding and collapsing," with
  distinct `mat-panel-title` and `mat-panel-description` slots; an optional action bar at the
  panel's bottom is "visible only when the expansion is in its expanded state"; with
  `multi="false"` (the default) "just one panel can be expanded at a given time"
  ([expansion docs](https://github.com/angular/components/blob/main/src/material/expansion/expansion.md)).
- **Material 1's original spec** framed the expanded state as *more of the same element*, not a
  different element: "a collapsed panel expands, allowing users to add or edit information," and
  "Expansion panels may be displayed in a sequence to form creation flows"
  ([M1 expansion panels](https://m1.material.io/components/expansion-panels.html)) — the
  sequence-of-panels-as-flow being precisely the accordion-as-journey structure the stride screen
  wants.
- **GitHub Primer** (progressive disclosure): "Pair progressive disclosure icons with descriptive
  text to provide context," and — the principle the direction conflict violates — "Refrain from
  creating interactions that drastically disorient the user's initial point of focus"
  ([Primer progressive disclosure](https://primer.style/design/ui-patterns/progressive-disclosure/),
  [source mdx](https://github.com/primer/design/blob/main/content/ui-patterns/progressive-disclosure.mdx)).

The consistent grammar **[synthesis]**: the summary row keeps *identity plus a one-line summary*
(title + description/metadata) in both states; the panel carries *everything else*; state-dependent
extras (Material's action bar) appear inside the panel, never as a second header. No system
surveyed re-renders the summary's content inside the panel — the summary is a *preview* that the
open state fulfils, not a sibling that the open state repeats.

**What this means for the ledger:** the stride header's slots map cleanly onto
`mat-panel-title` / `mat-panel-description`: one primary text (title *or* destination gist — §7
argues for the destination) and one metadata tail (map number, `n decided · date`, live meter).
The panel then must not restate whichever text the header claimed. The `the destination` caption
is a preview-fulfilment relationship drawn wrongly as a repetition.

## 3. The collapsed thing *becoming* the open thing: container transform

Material's container transform is the one motion pattern designed for exactly this joint. It is
"designed for transitions between UI elements that include a container" and "creates a visible
connection between two UI elements"; the shared element is not a piece of content but "the
bounding container of a start `View`... transforming its size and shape into that of an end
`View`," while "their contents are swapped to create the transition." Canonical examples: "a card
into a details page," "a list item into a details page"
([Material Motion docs](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md);
pattern home at [m3.material.io](https://m3.material.io/styles/motion/transitions/transition-patterns)).

The transferable idea is stronger than the animation **[synthesis]**: the collapsed stride and the
open stride are *one container at two densities* — the container persists, and its contents are
exchanged, not stacked. Under that model there is no "header above a ledger": the collapsed row's
text is the low-density rendering of the very thing the open state renders at high density. The
prototype's variant A already applied this at project-card scale ("the card is literally the
screen at a second density"); the same thesis applies one level down, at the stride. Whatever text
the collapsed row shows should be *found again* inside the open state in the same role — grown,
not duplicated. If the collapsed row shows the destination gist, the open state's destination text
is that same element expanded; if the collapsed row shows a title, the title persists as the open
panel's heading and the destination must visibly be body, not heading.

**What this means for the ledger:** pick one text to be the container's identity and let it
transform. The cheapest honest version needs no animation at all — just the discipline that the
open state never re-introduces, in heading dress, a text the collapsed state already carried.

## 4. Two mark families on one line: the transit interchange grammar

The rail needs map-level nodes (collapsed strides) and ticket-level nodes (inside a ledger) to
read as different families without a legend. Transit line diagrams have solved exactly this — one
line carrying marks at two scales — and TfL's published standard is unambiguous about how
([TfL Line Diagram Standard, Issue 4, January 2025](https://content.tfl.gov.uk/tfl-line-diagram-standard.pdf)):

- Ordinary stations are **ticks**: small marks in the line's own colour, attached to one side of
  the line — "Station ticks are 0.66x squared," where the 'x' height "is equal to the thickness
  of the route line" (§5).
- Interchanges are **rings**: "Interchange stations are denoted by circles. These circles are
  always printed in black with the centre left free of any print" (§8) — a different *shape
  class* (hollow vs solid), a different *colour logic* (always black, regardless of line colour),
  and a different *relationship to the line* (straddling it, not attached to one side).
- Termini are a third, rarer mark: a "Double tab is used to indicate the end of the line," and a
  "Ring [is] to be used where station at the line end is an interchange" (§10.1); arrows mean
  "a line continues beyond the stations shown" (§7).
- Metadata hangs off the mark in a fixed slot, never floating: "Flag boxes are always centred
  beneath the interchange circle and never above. When a flag box is required, the station name
  always appears above the interchange circle" (§10).

The lesson is that the two families are distinguished by *kind*, not by degree **[synthesis]**:
not a bigger tick but a categorically different mark — hollow where ticks are solid, achromatic
where ticks carry line colour, symmetric about the line where ticks are one-sided. Size alone is
never the discriminator. The ledger's existing node grammar already lives entirely in the tick
family (9px state markers, the ✓ discs, ghost fog rings); the map-level family is unclaimed.

**What this means for the ledger:** collapsed strides should carry interchange-class marks —
larger, hollow-or-inverted, straddling the rail, in a neutral colour rather than a state colour —
and their metadata (title tail, meter) should hang in one fixed slot per mark, TfL-flag-box style.
Ticket nodes inside an open ledger then read as "local stops on this line" without any size war.
The destination ⚑ is arguably interchange-class too: it is where this map's line *ends* and the
next stride's line begins — a terminus ring, in TfL grammar.

## 5. A dated header over a rich artifact: releases and changelogs

The stride screen's closest non-spatial relative is a release history: a vertical sequence of
dated headers, each owning a rich body it does not compete with.

- **GitHub Releases**: "Releases are based on Git tags, which mark a specific point in your
  repository's history"
  ([About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)).
  The header row is identity — tag, title, date — and the body is the artifact (notes, assets).
  The notes body never restates the release title as a heading; the title lives once, in the
  header.
- **Keep a Changelog**: version headers are `## [1.1.2] - 2024-09-27` — identity plus date, one
  line — with the body as grouped change entries beneath; "The latest version comes first," and an
  `Unreleased` section sits at the top so "people can see what changes they might expect in
  upcoming releases" ([keepachangelog.com](https://keepachangelog.com/en/1.1.0/)).
- **Linear's changelog** renders the same anatomy in product form: a date line, a title that links
  to the full post, then the artifact body (prose, images, grouped fix lists), newest entry first
  ([linear.app/changelog](https://linear.app/changelog)) **[structure observed 2026-08-12]**.

Two transferable rules **[synthesis]**: (1) the header stays *thin* — identity and date, nothing
the body will repeat; the body carries all richness. (2) These genres are **newest-first** because
they are *lists consulted for the latest entry*, not chronicles read through — which is the fork
in the road for §6. Note also keep-a-changelog's `Unreleased`: the one place the genre represents
the future, and it does so as a *differently-labelled section in the same column*, not a direction
change — structurally the same move as the ledger's fog section.

**What this means for the ledger:** the stride header wants the changelog-header register: map
title (or destination gist) + date/count tail, one line, visually thin. Everything else — including
the destination *prose* if the header carries only a gist — belongs to the body. And if the screen
ever needs to justify journey-order (oldest first) against the newest-first convention of this
genre, the answer is that the stride screen is read as a chronicle, not consulted as a list — see
next section.

## 6. Direction handover: what happens when a list meets content with its own arrow

### 6a. The two genre conventions

Vertical time runs in two directions in shipped software, split cleanly by genre
**[synthesis over the sources below]**:

- **Newest-first (future above, if anywhere):** `git log` — "By default, the commits are shown in
  reverse chronological order" ([git-log docs](https://git-scm.com/docs/git-log)); commit-graph
  tools draw the same way, newest row at the top, so the graph *grows upward* (surveyed in
  [docs/research/commit-graph-layouts.md](https://github.com/asmundwien/roadmap/blob/research/commit-graph-layouts/docs/research/commit-graph-layouts.md),
  primary survey: [pvigier](https://pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html));
  changelogs and release pages (§5). These are *lists*: the reader wants the latest thing, and
  scroll depth equals age.
- **Oldest-first, live edge at the bottom:** chat, and threaded email — Gmail groups replies
  "with the latest email at the bottom of a conversation thread"
  ([Gmail Help](https://support.google.com/mail/answer/5900)); GitHub issue timelines behave
  identically **[observed]**. These are *chronicles*: the reader enters at the top or at the live
  edge, and new material appends where the reader is waiting, at the bottom.

The stride accordion — journey order, active map at the foot, new decisions appearing at the foot —
is unambiguously the chronicle genre. Its downward arrow is correct and well-precedented; it is
the embedded ledger's upward arrow that is the anomaly at the joint.

### 6b. The instructive flip that already ships: inbox vs thread

Gmail's inbox lists conversations newest-first; opening one flips time — the thread reads
oldest-at-top, newest-at-bottom (sources above). This is a mass-deployed precedent for "a list
whose items internally run the other way," and its lesson is double-edged **[synthesis]**: it
ships, at scale, so a direction flip at an open/close joint is *survivable* — but it survives
because **no visual element claims continuity through the joint**. The inbox row and the thread
share no line, no rail, no spatial metaphor; the flip is purely conceptual, and even so it
generates a steady stream of user complaints and third-party "reverse my threads" extensions
([Gmail community thread](https://support.google.com/mail/thread/204057414/how-to-rearrange-a-conversation-to-newest-at-the-top)).
The stride screen is in a strictly worse position: its whole thesis is one rail threaded through
the joints. A rail that visibly connects both sides makes the direction conflict a *drawn
contradiction* rather than a conceptual wrinkle.

### 6c. What transit does: normalize direction to the reader, per artifact

Transit diagrams never tolerate mixed direction inside one artifact — they redraw. TfL's vertical
platform diagrams re-anchor the whole line to the reader's position: "The host station name is
always to appear first, reversed out of a Corporate blue box," with the remaining stations listed
beneath in the order the train will reach them
([TfL Line Diagram Standard](https://content.tfl.gov.uk/tfl-line-diagram-standard.pdf), §11) —
that is, **you-are-here at the top, the future below**, regardless of compass direction. In-car
strip maps are likewise produced per direction of travel so the passenger always reads forward;
the artifact flips, the reading direction never does **[synthesis; the standard's §11 host-first
rule is the documented instance]**. Cartographically, "future below" has first-class precedent —
it is how every platform diagram and printed itinerary reads, because text flows downward and the
next thing you'll reach should sit where reading takes you next.

**What this means for the ledger:** the transit answer to "which way should the embedded ledger
read" is: *the traveller's way, in this context* — and in the chronicle context the traveller is
moving down the page. Flipping the embedded ledger (ground covered at top, continuing the trace
that arrives from the older strides above; destination at the bottom) is not a betrayal of the
map grammar; it is what line diagrams themselves do when re-embedded in a directional context. The
counterweight is the commit-graph lineage: the ledger's braid geometry was researched and built on
tools that grow upward, and CONTEXT.md's "destination pinned in view as the thing travelled
toward" currently cashes out as destination-on-top. But nothing in the braid geometry is
direction-dependent — the lane rules survive a y-flip untouched **[synthesis, from reading
`geometry.ts`]** — and "pinned in view" is a salience requirement, not a compass bearing.

---

## 7. Proposed redesign directions

Three directions, deliberately different in how much they change. My order of preference is
1 > 3 > 2, and 2's mark grammar should be adopted regardless of which direction wins.

### Direction 1 — The destination is the header (promote and dedupe)

**Anatomy.** The collapsed stride's primary text *is the destination gist* (variant B already
plays this) with the map title, `n decided`, and date demoted to a metadata tail — changelog-thin,
one line, `mat-panel-title` + `mat-panel-description` in Material's terms. On open, the header
row stays exactly where it is and becomes the open map's crown: same text, grown to the ledger's
destination type size, with the ⚑ terminus mark sitting on the rail at the header's left — the
header's own node. Inside the panel, the ledger renders *without* its destination block and
without the `the destination` caption: the panel begins at fog. The header is the destination;
the caption's job is done by position and the flag.

**Backing.** APG: the header is the label for the panel, and a panel must not re-render its label
as a second heading (§1). Container transform: one container, two densities, contents swapped —
the gist literally grows into the full destination text (§3). Carbon/Angular Material: title +
description in the summary, everything else in the panel (§2). Releases/changelogs: thin identity
header, rich body, title lives once (§5).

**Tradeoffs.** The map *title* loses primacy — for wayfinder maps whose titles are administrative
("Map: v2 restructure") that is a feature, but any screen real estate the title needs (linking to
the issue, disambiguating two open maps) must fit the tail. The direction conflict is only
*softened*, not solved: the open panel still reads upward internally, but the flip now happens at
a meaningful landmark — the destination-header is the top of the map, so "everything below this
line is the walk toward it" is at least a statable rule, and reading the open stride top-to-bottom
gives aspiration → fog → charted → most-recent-ground, i.e. goal first, present state last, which
is how an issue page reads (title/spec at top, latest activity at bottom) **[synthesis]**.

**Open questions.** Does the destination gist compress to one collapsed line for real maps, or
does the header need two lines (gist + tail)? When a project has two open maps, do two
destination-headers read as competing aspirations, and is that honest (it is) or noisy?

### Direction 2 — The interchange joint (keep the ledger; make the seam a station)

**Anatomy.** The ledger stays exactly as built, upward travel included. The joint is redesigned
instead: collapsed strides carry interchange-class marks — hollow rings straddling the rail,
achromatic, categorically unlike the 9px state-tick family inside ledgers (§4) — and the rail is
*segmented* (variant B): one solid chunk per stride, a deliberate gap at each joint, so no single
line ever claims to flow continuously through an open panel. The open stride is framed as an inset
artifact — a bordered/backgrounded region, "the map unrolled on the table" — whose internal trunk
is visibly *its own line*, joined to the project rail at two interchange rings: the stride header
above (where you entered) and nothing below (the active map is the last stop). The header keeps
map title + tail; the ledger keeps its destination block, but the caption drops its heading dress
(smaller, inline with the flag) so the panel's top reads as the map's own terminus, not a rival
title.

**Backing.** TfL: direction changes and line changes are mediated by a distinct mark family, and
two scales coexist on one diagram only because the families differ in kind (§4). Gmail: a
direction flip at an open/close joint ships successfully *when nothing visual claims continuity*
(§6b) — segmentation is what buys the flip. The issue-#12 comment's own hunch — does the flip read
"as broken or as 'entering the map'" — this direction is the "entering the map" answer, made
explicit by drawing the threshold.

**Tradeoffs.** The narrative flip remains; this direction spends its effort making the flip
*legible* rather than removing it. The one-continuous-roadmap thesis is weakened — the rail
becomes a chain of segments, which is honest (each map is its own journey) but gives up some of
the v2 pitch. Two title-ish texts still exist (header title, destination text); the fix here is
typographic demotion rather than structural removal, which is the weakest part of this direction
and why I rank it last.

**Open questions.** Can a segmented rail still read as "one roadmap" on the project card at small
scale? Does the inset framing survive dark/light theming without turning into a "card," the genre
CONTEXT.md forbids?

### Direction 3 — The chronicle flip (one direction of travel for the whole app)

**Anatomy.** Flip the ledger — embedded *and* standalone, to keep one grammar — so it reads
downward: ground covered at the top (the trace arriving from the strides above), HEAD, charted
ahead, fog, and the destination as the *bottom* edge of the map. The whole project screen then has
a single arrow: down is forward, everywhere. A closed stride's header line sits where its
destination was reached, so reading the page top to bottom is literally walking the project:
map 1's ground → its destination reached → map 2's ground → … → the active map's ground → HEAD →
charted → fog → **the destination, as the last line of the page** — the frontier of the whole
chronicle, sitting exactly where new content appends and where a chat's live edge sits. The
stride header carries title + date tail (destination text now has a unique home at the panel's
foot, so the header/destination competition dissolves by separation rather than merger).

**Backing.** TfL vertical platform diagrams: you-are-here first, the future below, in reading
order (§6c). Chat/threads: live edge at the bottom is the chronicle convention, and this screen is
a chronicle (§6a). Primer: no disorientation at the point of focus — one arrow means the joint
never flips anything (§2). The braid geometry is direction-agnostic, so the cost is a y-flip plus
re-reading, not a re-research **[synthesis]**.

**Tradeoffs.** Breaks with the commit-graph lineage the ledger grammar was built on (tools grow
upward, §6a) — though that lineage was always a *list* convention borrowed into a map. "Climbing
toward the destination" becomes "walking down the page toward the destination," which is weaker as
a metaphor of ascent but stronger as a metaphor of reading. The standalone map screen changes for
consistency's sake, which relitigates a settled design. Destination salience must survive the
move: at the bottom it is the natural end of every scroll (good) but no longer "pinned in view"
on entry (risk — may need the destination echoed in the header gist, which quietly re-imports
Direction 1).

**Open questions.** Does fog read correctly *above* the destination (fog as the last territory
before the flag) — arguably more honest than today's fog-below-destination, since you cross the
fog to reach the flag? Does frontier salience (the one place action is possible) survive moving
from "bottom of the ahead section" to "top of the ahead section"?

### The composable piece

Whichever direction wins, adopt §4's mark grammar now: map-level marks on the rail are a distinct
interchange-class family (hollow, achromatic, straddling the rail, metadata in one fixed slot),
ticket-level marks stay the existing tick family, and the destination flag is terminus-class. That
decision is independent of the header text and of direction, it is backed by the strongest primary
source in this document, and all three directions above assume it.
