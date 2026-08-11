# Research: what makes commit-graph lane layouts legible

Feeds the map view ([#3](https://github.com/asmundwien/roadmap/issues/3)). Question: variant G
(`src/prototypes/map-view/variant-g-confluence.tsx` on `prototype/map-view`) draws a wayfinder map
as a git history read bottom-to-top, and its lane layout works but does not satisfy — lanes are
per-node (barycentric mean of blockers, nudged apart), merges drift toward the canvas centre, the
braid feels arbitrary. What do real commit-graph tools and the graph-layout literature say makes a
small DAG (5–30 nodes) legible as branch-and-merge geometry, what makes it fail, and which
alternative layouts are worth prototyping?

**Verdict up front: legibility comes from lane discipline, not layout optimization.** Every
commit-graph tool that reads well converges on the same three rules: *branches own lanes* (a lane
is a persistent rail claimed at fork and released at merge — never a per-node position), *the
mainline never moves*, and *all curvature lives in short connectors at forks and merges while the
rest of every edge is a dead-straight rail*. The academic line reaches the same place from the
other side: barycentric averaging is only the middle phase of the Sugiyama framework, and without a
coordinate-assignment phase that aligns chains into straight verticals (Brandes–Köpf), it produces
exactly the wander variant G exhibits — the storyline literature even names the defect ("wiggle")
and makes minimizing it a first-class metric alongside crossings and whitespace. At 5–30 nodes no
global optimizer is needed; the greedy disciplines the git tools use are sufficient and, unlike
optimizers, are deterministic and stable under the live-poll updates this view must survive. The
one honest tension: every real git tool pairs its graph with text in aligned rows, which is
precisely the "list" genre-read the journey-grammar criteria forbid — variant G's freedom to label
at the node is a genuine divergence from all precedent and needs its own discipline rather than
borrowed ones.

Claims are cited inline. Paragraphs that are my own synthesis rather than a sourced claim are
marked **[synthesis]**.

---

## 0. What variant G does today, precisely

Baseline for everything below **[synthesis, from reading the source]**. The closed trace is a
straight centre trunk (`x = CX`) that thickens per decision; HEAD sits at its top. Layers ahead
come from `layerMap`/`orderLayers`; within each layer, a frontier ticket's desired x spreads
evenly off HEAD, and any deeper ticket's desired x is the *mean of its open blockers' lanes* —
pure barycentre — falling back to `CX` when no blocker is placed. `spaceLanes` then runs six
relaxation passes pushing same-layer neighbours apart to a 132px gap. Edges (`rail`) are an S-bend
at the source followed by a straight segment to the target.

Consequences: a "lane" exists only per node — the same chain of tickets gets a freshly averaged x
at every layer, so nothing accumulates into a rail; every barycentre step regresses toward the
mean of whatever is below, so merges drift to the canvas centre; and the relaxation passes are
order-dependent, so a small data change can reshuffle the braid. Each of these has a name and a
prior in the sources below.

---

## 1. Git tooling in the wild

### The lane-assignment family: first-free-lane with branch stickiness

The clearest written-down algorithm is GitX's
([GraphingAPI.txt](https://github.com/pieter/gitx/blob/master/Documentation/GraphingAPI.txt)):
walk commits row by row keeping a register of active columns; if the commit matches an existing
column, it takes that column and its **first parent inherits the lane**; if it also belongs to an
earlier column, draw a connecting line and **discard the later column** (lane retirement at a
merge); unmatched columns persist unchanged through the row; unseen parents open new columns.
That is the whole genre in four rules: lanes persist, first-parent continuity keeps a branch in
one column, merges retire lanes, forks allocate the first free one. gitk / `git log --graph`
belong to the same family but reorder commits topologically to pack lanes tighter — the pvigier
survey notes gitk "draws a graph very similar to the one printed by `git log --graph`" and is
"much more compact"
([pvigier, Commit Graph Drawing Algorithms](https://pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html)).

That survey is the best single map of the design space. It splits the tools along two axes —
one-commit-per-row (Git Extensions, gitk, GitKraken, SmartGit, SourceTree) vs. several per row
(git-cola), and **straight branches** (GitKraken, SourceTree) vs. curvy ones (gitk, SmartGit) —
and its own algorithm (gitamine) is built explicitly around straightness: a *branch child*
"continues a branch" and takes its parent's column, while a *merge child* "ends a branch by
merging it into another one"; new columns are chosen avoiding *forbidden columns* — positions from
which the commit could not be linked to a child without overlapping an existing edge. GitKraken's
own marketing leads with the same property — clearly separated branch lanes, merges visible as
lane convergence ([GitKraken commit graph](https://www.gitkraken.com/features/commit-graph)) — and
pvigier observes it orders rows by committer date.

### What users complain about

The complaints are the success criteria photographed in negative:

- **Lane instability.** The magit thread on making log graphs readable
  ([magit#2989](https://github.com/magit/magit/issues/2989)) diagnoses `git log --graph` as
  unreadable because it "tries too hard to preserve horizontal space", and its central proposal is
  that "all commits of a given branch are drawn in the same column, **even when that wastes
  horizontal space**" — trading width for lane identity, explicitly.
- **False adjacency.** Git Extensions' oldest layout bug report
  ([gitextensions#24](https://github.com/gitextensions/gitextensions/issues/24)): the graph
  "often connects dots when it is not supposed to (showing a parent-child relationship that
  doesn't exist)". Edges that pass close to unrelated nodes are read as touching them.
- **Compactness worship at scale** — "git log --graph is unreadable on large repos" is by now a
  product tagline for replacements ([gittree](https://github.com/makalin/gittree)).

### Drawn simplification: Sapling and jj

Sapling's smartlog is the strongest precedent for *not drawing the whole graph*. Meta's launch
post: "Equally important, the smartlog hides all the information you don't care about. Remote
branches you don't care about are not shown. Thousands of irrelevant commits in main are **hidden
behind a dashed line**"; what remains is "your local commits, where you are, where important
remote branches are" ([Meta engineering](https://engineering.fb.com/2022/11/15/open-source/sapling-source-control-scalable/);
[smartlog docs](https://sapling-scm.com/docs/overview/smartlog/)). Structurally: mainline is a
single reference rail on the left, elision is drawn honestly (dashed, not absent), the traveller
is a distinguished glyph (`@`), and everything shown is something you can act on. jj's log makes
the same moves with a typed glyph vocabulary — `@` working copy, `◆` immutable, `○` mutable — and
renders elided revision spans as an explicit synthetic "(elided revisions)" node rather than
silently connecting across them ([jj log](https://docs.jj-vcs.dev/latest/cli-reference/#jj-log);
[jj#2971](https://github.com/jj-vcs/jj/issues/2971)).

GitHub's network graph is the cautionary tale at the other end: time on the x-axis, one row per
branch, every commit of every fork ([GitHub blog, 2008](https://github.blog/news-insights/say-hello-to-the-network-graph-visualizer/))
— complete, and famously read as an inscrutable metro map once more than a few people work
concurrently.

### Label placement — and the tension

Every tool above places text the same way: **graph rail in a narrow left gutter, one row per
commit, message/author/date in aligned columns to the right**. Zero exceptions among gitk,
GitKraken, Fork, Sublime Merge, Sapling, jj, `git log --graph`. It works because a row is a stable
address: the label can be arbitrarily long, never collides, and never influences graph geometry.
But this is exactly the rows-as-accountability, table-genre reading that the journey-grammar
research disqualified for this project ("no card columns", "geometry that needs no decoding" —
[journey-visualisation-grammars.md](journey-visualisation-grammars.md) on
`research/journey-visualisations`). Recording the tension honestly: the entire commit-graph genre
achieves label legibility by being half a list, and variant G refuses that. There is no precedent
to borrow for free-floating node labels on a braid; the closest priors are the storyline systems
in §3, which label along the line, and metro maps, which own the hardest version of the problem
(Nöllenburg treats labeling as part of the optimization itself, §4).

---

## 2. Sugiyama layered drawing — why barycentre alone wanders

The canonical framework ([Gansner, Koutsofios, North, Vo — *A Technique for Drawing Directed
Graphs*](https://www.graphviz.org/documentation/TSE93.pdf); survey in [Healy & Nikolov,
*Hierarchical Drawing Algorithms*, GD Handbook ch. 13](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf))
has four phases: rank assignment (network simplex in dot), **within-rank ordering** (median/
barycentre plus transposition sweeps to reduce crossings), **coordinate assignment**, and spline
routing. The part everyone remembers — barycentric ordering — only decides the *permutation* of
each layer. Geometry comes from the third phase, and dot spends real machinery there: an auxiliary
graph solved to place nodes so that edges are short and, critically, chains of virtual nodes
(long edges crossing layers) are drawn **straight**, with priority given to keeping them so.

Variant G implements phase two's averaging as if it were phase three **[synthesis]**: it uses the
barycentre *as the coordinate*. The framework itself predicts the observed failure — averaging is
a contraction toward the mean, so successive layers regress toward centre (merge drift), and
nothing ties a node's x to its chain-predecessor's x (no rails). The literature's fix is exactly
alignment: [Brandes & Köpf, *Fast and Simple Horizontal Coordinate
Assignment*](https://link.springer.com/chapter/10.1007/3-540-45848-4_3) is the standard
linear-time phase-three algorithm — align each node vertically with one median neighbour, chain
those alignments into rigid vertical *blocks*, compact blocks subject to minimum separation, do
this four times (up/down × left/right) and balance — guaranteeing at most two bends per edge and
long straight runs. (It ships with known errata worth reading before implementing:
[arXiv:2008.01252](https://arxiv.org/abs/2008.01252).) Healy & Nikolov also catalogue the
framework's general costs: the aesthetic criteria conflict, most subproblems are NP-hard, and
heuristics are tuned for hundreds of nodes — at 5–30 nodes the machinery is affordable but mostly
unnecessary if lane discipline is imposed structurally **[synthesis]**.

---

## 3. Storylines — the sharpest metrics available

Storyline visualizations (continuous character lines through a narrative) are the research genre
closest to a braid of persistent lanes, and they wrote down the legibility function. [Tanahashi &
Ma, *Design Considerations for Optimizing Storyline Visualizations* (TVCG 18(12), 2012)](https://www.researchgate.net/publication/260582986_Design_Considerations_for_Optimizing_Storyline_Visualizations)
define three measurable properties a layout must minimize:

1. **Line crossings** — determined purely combinatorially by the sequence of per-timestep
   permutations (independent of geometry);
2. **Line wiggles** — every line should run as straight as possible, deviating only when an
   interaction (grouping) forces it;
3. **Whitespace** — dead area inflating the drawing.

Crossings depend only on ordering; wiggle and whitespace depend on the actual coordinates — the
same phase-2/phase-3 split as Sugiyama, discovered independently. [StoryFlow (Liu et al., TVCG
19(12), 2013)](https://www.shixialiu.com/publications/storyflow/paper.pdf) operationalizes it as a
hybrid pipeline — discrete ordering + alignment for the permutations, then continuous (quadratic)
optimization of y-coordinates for straightening and compaction — fast enough to re-layout
interactively. The line of work continues (crossing minimization in storylines is NP-hard:
[Gronemann et al.](https://link.springer.com/chapter/10.1007/978-3-319-50106-2_29); wiggle
minimization is now studied as its own problem:
[Dobler et al., GD 2025](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.GD.2025.39)).

Transfer to a ticket braid **[synthesis]**: read *branch chain* for *character* and *merge* for
*meeting*, and the three metrics apply verbatim — and they rank variant G's defects: its braid has
low crossings (fine), but maximal wiggle (every layer re-averages every lane) and no whitespace
control other than clamping. The storyline result worth stealing is structural: get the
*ordering* right once, then hold lines straight by default and bend them only at events. Lines
that wiggle without an event are lying about an interaction that didn't happen.

---

## 4. Metro maps — octilinearity as a bend discipline

The automated metro-map literature ([Nöllenburg & Wolff, *A Mixed-Integer Program for Drawing
High-Quality Metro Maps*](https://www1.pub.informatik.uni-wuerzburg.de/pub/wolff/pub/nw-mipdh-06.pdf),
extended in their 2011 TVCG paper) formalizes the Beck aesthetic as hard constraints — every edge
octilinear (0°/45°/90°), minimum edge length, topology preserved — with soft costs for bends,
total length, and relative-position distortion, solved by MIP; the hard constraints are guaranteed
whenever feasible, and labeling is folded into the same optimization rather than done after. The
costs are equally documented: the problem is NP-hard, MIP solve times are minutes for real
networks, and the genre imposes its look — the journey-grammar survey already rejected Beck-metro
as a *frame* for this project (nothing native for any of the four states, plus its power to
override reality in readers' heads).

What survives as a component **[synthesis]**: octilinearity is a *bend discipline*, not a genre.
"Rails are vertical; every deviation is exactly 45°, short, and terminates at an event" makes each
bend read as intentional — a fork or a merge — instead of as noise. That discipline can be applied
to variant G's connectors without importing the transit look, and it collapses the label problem
to two stable cases (label beside a vertical rail, label past a 45° join).

---

## 5. Synthesis

### (a) Success criteria for a legible small-DAG lane layout [synthesis]

1. **Branches own lanes, not nodes.** A lane is a persistent rail: claimed when a chain forks
   into existence, held at a constant x for the chain's whole life, released when it merges.
   Every ticket on the chain shares the rail's x (GitX lane register; magit#2989's same-column
   demand; storyline lines-as-identities).
2. **The mainline never moves.** Trunk fixed at one x for the entire drawing, unperturbed by
   anything ahead of HEAD; ideally the trunk's lane continues visibly toward the destination
   (Sapling's mainline reference rail; variant G already has this below HEAD — extend it above).
3. **Straight by default; bend only at events.** Every edge is a vertical rail except for a short
   connector at a fork or merge. Zero mid-run bends: a bend must mean something happened
   (GitKraken/gitamine straight-branch rule; Tanahashi–Ma wiggle metric; dot's
   straighten-the-inner-segments priority).
4. **Minimize crossings by ordering, then stop.** Decide left-to-right order of chains once
   (crossings are purely combinatorial — Tanahashi–Ma), accept the crossings that remain, and
   make them cross decisively — near-perpendicular, once — never tangentially alongside a rail.
5. **Merges are lane-retirement events on a surviving rail.** A merge node sits *on* the lane of
   one designated incoming chain (or the trunk), and the other incoming rails visibly bend in and
   end there. A merge is never placed at an averaged position between its parents (GitX "discard
   the previous column"; every straight-branch tool).
6. **Deterministic and update-stable.** Same DAG ⇒ identical picture; one ticket added or closed
   ⇒ minimal visual delta. No relaxation loops whose result depends on iteration order — this
   view re-renders on a 30s poll, and object permanence dies otherwise (StoryFlow's stability
   concern; the fog-of-war grammar's "layout must be kept stable across polls" from the journey
   survey).
7. **Trade width for identity, within a cap.** Never reuse or shift a lane to save horizontal
   space (magit#2989) — but cap total lanes (5–7 at this scale) and elide beyond the cap rather
   than shrinking gaps until rails blur.
8. **Drawn elision.** Anything hidden is shown *as hidden* — dashed span, synthetic "elided"
   node, fog — never silently bridged (Sapling's dashed mainline; jj's elided-revisions node;
   this repo's existing `ticketsTruncated` honesty habit).
9. **Labels have one stable address per lane.** Each rail owns a labeling side and offset
   (e.g. outboard: left lanes label left, right lanes label right), labels never influence
   geometry, and no accidental horizontal alignment of labels across lanes — three labels on one
   y-line re-create the table row (the §1 tension, inverted into a rule).
10. **Keep the journey invariants.** One direction of travel, behind drawn differently from ahead
    (solid vs dashed), ignorance drawn as fog, no time axis, no legend needed to decode geometry
    (carried over from
    [journey-visualisation-grammars.md](journey-visualisation-grammars.md) — the lane layout must
    not win legibility by breaking these).

### (b) Pitfalls [synthesis]

1. **Barycentric coordinates.** Using the layer-ordering average as the x-coordinate contracts
   every layer toward the mean: merges drift centreward and chains wander — the Sugiyama
   framework's phase-2 tool doing phase-3's job (Gansner et al.; observed in variant G).
2. **Per-node lanes.** Recomputing x per node destroys line identity; the reader cannot track a
   chain because there is no chain to track (the defect behind magit#2989's complaint).
3. **Compactness worship.** Optimizing horizontal space first is the documented reason
   `git log --graph` fails at complexity (magit#2989; gittree's tagline).
4. **False adjacency.** Curves passing near unrelated nodes read as connections
   (gitextensions#24). Corollary: connectors must depart/arrive steeply and never run tangent to
   a rail they don't join.
5. **Merge mush.** A merge placed between its parents, with near-parallel shallow incoming
   curves, reads as drift rather than convergence — the exact opposite of the merge's meaning
   (variant G today; contrast criterion 5).
6. **Drawing everything with equal confidence.** The whole-universe graph is GitHub's network
   view; the fix is Sapling's: show the traveller's work plus the mainline, elide the rest
   visibly (Meta engineering post).
7. **Motiveless wiggle.** Any bend not at a fork/merge event asserts an interaction that didn't
   happen (Tanahashi–Ma; StoryFlow's straightening objective).
8. **Order-dependent relaxation.** Iterative pairwise nudging (`spaceLanes`) is
   input-order-sensitive: small data deltas reshuffle the braid and break object permanence
   between polls (StoryFlow's motivation for principled compaction over ad-hoc repulsion).
9. **Rows through the back door.** Solving label collisions by aligning labels in horizontal
   bands re-imports the list/table genre the project rejected (§1 tension; journey survey's
   "rows-as-accountability").
10. **Unbounded lane growth.** Lane count and lane-colour identity degrade together past ~6–8
    concurrent lanes (GitX's color-modulo shrug; GitHub network graph's metro-map reputation) —
    at 5–30 nodes this is avoidable by capping and eliding, so hitting it is a choice.

### (c) Alternative representations worth prototyping [synthesis]

Each keeps variant G's fixed skeleton — trunk of closed decisions at CX, HEAD marker, fog band,
pinned destination — and replaces only the ahead-of-HEAD braid.

**H. Rails-and-sidings** — commit-graph orthodoxy transplanted.
- *Lane assignment:* decompose the ahead-DAG into chains by first-blocker inheritance (each
  ticket's rail is its first open blocker's rail unless that rail is already inherited; then it
  forks a new one — the GitX register upside down). Allocate new rails centre-out, alternating
  sides of the trunk, first-free-slot at fixed pitch; slot order decided once by a deterministic
  sort (chain weight desc, then ticket number) so re-layouts are stable.
- *Edge routing:* rails are vertical lines; a fork is a connector leaving HEAD (or the parent
  node) that bends once onto the new rail within ~40px; a merge is the mirrored bend into the
  surviving rail. Between events, geometry is a straight vertical.
- *Merge rendering:* merge ticket sits on the surviving rail (rail of its heaviest incoming
  chain); all other incoming rails end at it. Lane retirement is drawn: the retired rail's dashes
  stop there.
- *Labels:* each rail owns its outboard side at constant offset; within a rail, labels stack with
  the node; same-y collisions across rails broken by a small deterministic y-stagger (never x).
- *Fixes:* wander, merge drift, braid arbitrariness, update instability — all four complaints —
  with ~the same code size as today.
- *Risks:* width grows linearly with parallel chains (needs the lane cap + elision rule);
  "surviving rail" choice can privilege an arbitrary chain — pick by descendant count and accept
  it.

**I. Confluence with Brandes–Köpf alignment** — the literature's own fix, at toy scale.
- *Lane assignment:* keep `layerMap`/`orderLayers`, but order by *median* blocker position with a
  transpose sweep (crossing pass), then run Brandes–Köpf coordinate assignment: align each ticket
  with its median open blocker into vertical blocks, compact blocks to minimum lane pitch, balance
  the four sweep directions (mind the published errata, arXiv:2008.01252).
- *Edge routing:* alignment makes most chain edges exactly vertical; remaining edges get at most
  two bends by construction — render them as the existing S-curve confined near endpoints.
- *Merge rendering:* a merge aligns with (sits directly above) its median blocker — on a rail by
  construction, not at an average.
- *Labels:* per-block side assignment (a block is a vertical run — label the whole run on its
  free side).
- *Fixes:* wander and drift via a proven algorithm rather than bespoke rules; degrades gracefully
  if maps grow.
- *Risks:* most code of the four for a result H approximates; block membership can flip when the
  DAG changes, so update stability needs seeded tie-breaking; alignment optimizes straightness,
  not narrative reading order.

**J. Tributaries** — mainline-first; the confluence metaphor taken literally.
- *Lane assignment:* the trunk continues *above* HEAD as a dashed spine at CX, running through
  the fog to the destination — the future mainline. The heaviest chain (most transitive
  descendants, tie-break lowest number) *is* the spine's occupant; every other chain is a
  tributary forked off HEAD, assigned outward lanes alternating sides in fork order. Tributaries
  merge *into* the spine (or into a larger tributary) at the blocked ticket that joins them —
  smaller flows join larger, never mutual averaging.
- *Edge routing:* octilinear discipline as bend grammar only: rails vertical, every join exactly
  one 45° segment ending on the target rail (soft corner radii so it doesn't read as transit).
- *Merge rendering:* merges always sit on the spine or on a continuing tributary; incoming rails
  end in the 45° join. The final visual statement is every lane converging on the destination —
  the metaphor variant G's name promises.
- *Labels:* spine labels alternate sides exactly like the trunk's existing waypoints (one
  continuous system below and above HEAD); tributary labels outboard.
- *Fixes:* merge drift structurally impossible; strongest one-direction-of-travel reading;
  destination stops being a floating flag and becomes where the trunk goes.
- *Risks:* electing a spine chain asserts a priority the map doesn't state (mitigate: style the
  spine ahead of HEAD identically to other dashes — position, not weight); 45° joins flirt with
  the rejected metro look if over-styled.

**K. Ledger rail** — the genre's own answer, as a control.
- *What:* adopt the universal git-tool layout wholesale for the ahead region: narrow braid gutter
  (rails at tight pitch, H's assignment rule), tickets as rows, full titles right of the gutter —
  Sapling's smartlog with wayfinder glyphs.
- *Why include it:* it is the only layout with decades of proof, and it tests whether the
  "row-alignment ⇒ list read" assumption actually holds once fog, trunk thickening, dashed
  future, and the destination flag are present. Cheapest of the four to build.
- *Risks:* high and known — rows-as-accountability is exactly the structural signature the
  journey survey says styling cannot fix. Build as a control to calibrate the criteria, not as a
  candidate; if it *doesn't* read as a list, criterion 9 and pitfall 9 are miscalibrated and
  worth revising.

Recommended order: **H first** (smallest delta, addresses every named complaint), **J** as the
metaphor-complete rival, **K** as the cheap control; **I** only if H's greedy rules visibly
misplace something on a real map that principled alignment would catch.

---

## Sources

- pvigier, *Commit Graph Drawing Algorithms* — <https://pvigier.github.io/2019/05/06/commit-graph-drawing-algorithms.html>
- GitX GraphingAPI — <https://github.com/pieter/gitx/blob/master/Documentation/GraphingAPI.txt>
- magit #2989, *more readable and semantic log graphs* — <https://github.com/magit/magit/issues/2989>
- Git Extensions #24, *Git Graph Visualization is Wrong* — <https://github.com/gitextensions/gitextensions/issues/24>
- gittree — <https://github.com/makalin/gittree>
- GitKraken commit graph — <https://www.gitkraken.com/features/commit-graph>
- Meta, *Sapling: Source control that's user-friendly and scalable* — <https://engineering.fb.com/2022/11/15/open-source/sapling-source-control-scalable/>
- Sapling smartlog docs — <https://sapling-scm.com/docs/overview/smartlog/>
- jj log CLI reference — <https://docs.jj-vcs.dev/latest/cli-reference/>; elided-node design: <https://github.com/jj-vcs/jj/issues/2971>
- GitHub, *Say hello to the Network Graph Visualizer* — <https://github.blog/news-insights/say-hello-to-the-network-graph-visualizer/>
- Gansner, Koutsofios, North, Vo, *A Technique for Drawing Directed Graphs* (TSE 1993) — <https://www.graphviz.org/documentation/TSE93.pdf>
- Healy & Nikolov, *Hierarchical Drawing Algorithms* (Handbook of Graph Drawing, ch. 13) — <https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf>
- Brandes & Köpf, *Fast and Simple Horizontal Coordinate Assignment* (GD 2001) — <https://link.springer.com/chapter/10.1007/3-540-45848-4_3>; erratum <https://arxiv.org/abs/2008.01252>
- Tanahashi & Ma, *Design Considerations for Optimizing Storyline Visualizations* (TVCG 2012) — <https://www.researchgate.net/publication/260582986_Design_Considerations_for_Optimizing_Storyline_Visualizations>
- Liu et al., *StoryFlow: Tracking the Evolution of Stories* (TVCG 2013) — <https://www.shixialiu.com/publications/storyflow/paper.pdf>
- Gronemann et al., *Crossing Minimization in Storyline Visualization* (GD 2016) — <https://link.springer.com/chapter/10.1007/978-3-319-50106-2_29>
- Dobler et al., *Optimizing Wiggle in Storylines* (GD 2025) — <https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.GD.2025.39>
- Nöllenburg & Wolff, *A Mixed-Integer Program for Drawing High-Quality Metro Maps* — <https://www1.pub.informatik.uni-wuerzburg.de/pub/wolff/pub/nw-mipdh-06.pdf>
- This repo: *Research: how progression and journey visualisations actually work* — [journey-visualisation-grammars.md](journey-visualisation-grammars.md) (branch `research/journey-visualisations`)
