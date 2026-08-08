# Research: how progression and journey visualisations actually work

Resolves [#9](https://github.com/asmundwien/roadmap/issues/9). Question: after a prototype round in
which every take was misread as an adjacent genre (kanban board, dashboard, inscrutable dome), which
visual grammars actually make a **journey** legible — without a legend, without a decoding step —
and which of them can carry a wayfinder map's four states at once: ground covered (closed), the
takeable edge (open + unblocked + unclaimed), the chained-and-waiting (blocked), and the fog
(uncharted)?

**Verdict up front:** across games, cartography, transit and project tooling, only one grammar has a
*native* encoding for "not yet charted" — fog of war — and only two grammars are read by naive
viewers as "a route someone is travelling": the campaign/run map and the itinerary strip map. The
tech tree natively encodes blocking but reads as a possibility space, not a journey. Everything in
the project-tooling family reads as a management artifact for structural reasons (time-as-axis,
rows-as-accountability), not fixable by styling. The shortlist at the end combines these.

Claims are cited inline. Where a paragraph is my own synthesis rather than a sourced claim, it is
marked **[synthesis]**.

---

## The four states, as demands on a grammar

Before surveying, it helps to name what each state *demands* of a visual channel **[synthesis]**:

- **Ground covered** is *past*. It wants a trace: something that visibly accumulates behind a
  direction of travel.
- **The takeable edge** is *present affordance*. It wants salience: the eye should land there first,
  because it is the only place where action is possible.
- **Chained-and-waiting** is *constrained future*. It wants visible causation: what it is waiting
  on, not merely that it waits.
- **Fog** is *absence of knowledge*. It wants an encoding of nothing that is distinguishable from
  an empty region of the canvas — the hardest of the four, because most grammars encode only what
  is known.

A grammar that lacks a channel for one of these will get it faked with colour-coding — and
colour-coding is precisely the legend-and-decoding-step this project is trying to avoid.

---

## 1. Game progression grammars

### 1a. Tech trees and skill trees

**What is encoded, where.** A tech tree is a directed graph: nodes are technologies/abilities,
edges are prerequisites, and position generally flows along an axis from early to late. Ghys's
survey of the genre defines it as "a structure that controls progress from one technology to a
better technology," structured either as near-linear upgrade ladders (Age of Empires) or as
interlocking vines with multiple prerequisites and alternative routes (Civilization IV lets you
reach rocketry via either flight or artillery)
([Ghys, *Game Studies* 12(1)](https://www.gamestudies.org/1201/articles/tuur_ghys)). State is
encoded as node fill/lock iconography: researched, available, locked. Path of Exile's passive tree
adds spatial semantics — clusters of related nodes form neighbourhoods, connected by low-value
filler nodes ([pathofexile.com](https://www.pathofexile.com/passive-skill-tree)).

**The glance device.** Clarity of the *route to a goal*. Soren Johnson (lead designer, Civ IV)
calls the tech tree "one of the great innovations of the original Civilization" precisely because
"it was always abundantly clear how to discover Gunpowder if you wanted to build Musketeers" — you
read backwards from a desire to a plan without any decoding
([Designer Notes, Old World #4](https://www.designer-notes.com/old-world-designer-notes-4-the-technology-deck/)).
Ghys adds that players "need a strong sense of deterministic progression" (quoting Johnson) and
that the tree narrates at three levels at once: the whole arc, the current era, and the immediate
next unlock ([Ghys](https://www.gamestudies.org/1201/articles/tuur_ghys)).

**Where it breaks down.** The same clarity produces determinism: because the whole future is
pre-charted, veteran players memorise the optimal sequence and replay it identically — which is why
Johnson replaced the tree with a shuffled card deck in Old World
([Designer Notes](https://www.designer-notes.com/old-world-designer-notes-4-the-technology-deck/)).
Density is the other limit: beyond roughly a hundred nodes the edge crossings dominate (Civ-scale
trees hover around 80 technologies; [Ghys](https://www.gamestudies.org/1201/articles/tuur_ghys)),
and PoE-scale trees (1300+ nodes) are famously unreadable to newcomers without third-party
planners **[synthesis from the sources above]**.

**Genre read.** "Game UI" / "unlock chart." Crucially, a tech tree shows a *possibility space*, not
a *journey*: there is no traveller, no trace of the route actually taken, and every node is drawn
with equal ontological confidence — the future looks exactly as solid as the past **[synthesis]**.

**Against the four states.** Blocked is *native* (locked node behind an unresearched edge — the one
state this grammar does better than any other). Takeable edge is native (the unlocked-but-unbought
ring). Ground covered is weak (filled nodes, but no trace or direction). Fog does not exist: the
whole tree is visible from turn one, which is the exact opposite of wayfinder fog.

### 1b. Campaign maps and run maps

**What is encoded, where.** The purest modern specimen is Slay the Spire's act map: a
vertically-ascending braid of nodes, ~15 floors high and up to 6 nodes wide, where every node
carries an icon for its room type (fight, elite, shop, rest, treasure, unknown, boss) and edges are
the only legal moves — 1–3 paths in, 1–3 paths out per node
([Slay the Spire wiki: Map Generation](https://slaythespire.wiki.gg/wiki/Map_Generation)). Position
encodes progress (height = floors climbed), the drawn path behind you encodes the route taken, and
the boss's face is printed at the top: the destination is a *picture*, always in view. Super Mario
World's overworld does the same on painted terrain: 96 exits across a connected landscape, where
levels holding secret exits are marked with red dots and finding one *draws a new path onto the
map* — the world visibly grows as you uncover it
([Super Mario Wiki: Secret exit](https://www.mariowiki.com/Secret_exit),
[strategywiki: SMW](https://strategywiki.org/wiki/Super_Mario_World/Star_World)).

**The glance device.** Three devices stack **[synthesis, from the sources above]**:
(1) *a single axis of travel* — up is forward, so past/future needs no legend;
(2) *the token* — "you are here" makes it a journey rather than a chart;
(3) *iconic nodes* — a picture of a campfire needs no decoding, where a colour-coded circle would.
Players verifiably use this for planning: the entire act is visible in advance and route choice
(hit the elite or detour to the rest site?) is the core strategic act
([wiki](https://slaythespire.wiki.gg/wiki/Map_Generation); an [arXiv study of StS maps](https://arxiv.org/html/2504.03918v1)
analyses exactly this plan-ahead legibility).

**Where it breaks down.** Width. The braid works at ≤6 parallel nodes; it encodes *alternative*
routes (choose one), not *parallel* work (do all). A wayfinder map's frontier is "take any and
eventually all of these," which the run-map grammar actively miscommunicates as "pick one and the
rest vanish" **[synthesis]**. It also assumes a mostly-forward topology; heavy cross-links between
distant branches have no home.

**Genre read.** "Board game / adventure route." This is the only graph grammar in the survey whose
naive reading is *itinerary* rather than *organogram* — the token and the destination picture do
that work **[synthesis]**.

**Against the four states.** Ground covered: native (traced path below the token). Takeable edge:
native (the nodes your edges reach — literally the only clickable things). Blocked: representable
(nodes beyond the frontier are visibly *further up the braid*), though "waiting on that specific
ticket" needs the edge to be followable. Fog: not native in StS (whole act pre-charted), but native
in the Mario variant, where paths beyond uncovered exits simply do not exist yet on the map.

### 1c. Fog of war

**What is encoded, where.** Knowledge itself, in the lightness channel. The lineage is precise:
Walter Bright's *Empire* (1977, PDP-10) covered unvisited map squares in black; exploration pushed
the blackness back, and once seen, terrain stayed visible
([Life & Times of Video Games, ep. 23](https://lifeandtimes.games/episodes/files/23)). Warcraft II
(1994) split the encoding into three levels — unexplored black, explored-but-unobserved grey shroud
(terrain remembered, activity hidden), and actively-seen ground — a distinction StarCraft carried
forward ([didacromero, Fog-of-War implementation history](https://didacromero.github.io/Fog-of-War/);
[Life & Times ep. 23](https://lifeandtimes.games/episodes/files/23)).

**The glance device.** Darkness *is* ignorance — a metaphor so old (Clausewitz's "fog of war" via
kriegsspiel and block wargames; [Life & Times ep. 23](https://lifeandtimes.games/episodes/files/23))
that no player has ever needed it explained. The reveal is also intrinsically *rewarding*: the
mechanic communicates progress as territory de-fogged, and designers note it produces "the tension
of not knowing what you will find when you take the next step"
([didacromero](https://didacromero.github.io/Fog-of-War/)).

**Where it breaks down.** Fog needs a *ground* to cover — a spatial field. Tickets have no inherent
geography, so using fog means inventing and stabilising a layout, and a layout that reshuffles on
every poll destroys the very object permanence that makes fog read as territory **[synthesis]**.
Fog also can't distinguish "we know nothing" from "we know there's something there but haven't
opened it" — that needs the Warcraft II two-tone trick (black vs. shroud).

**Genre read.** "Strategy game" — but note the direction of the borrowing: wayfinder's own
vocabulary ("fog," "frontier," "charted") is *already* this genre's vocabulary. The pastiche risk
is real but the metaphor is load-bearing, not decorative **[synthesis]**.

**Against the four states.** Fog is the *only* native encoding of the fourth state found anywhere
in this survey. Ground covered = revealed territory. The takeable edge = the boundary of the
revealed region — which is exactly where wayfinder's frontier sits conceptually. Blocked is not
expressed by fog itself and must come from a second grammar.

---

## 2. Transit diagrams: what Beck actually encoded

**What is encoded, where.** Beck's 1933 Underground diagram encodes *topology and interchange*, and
deliberately nothing else. An engineering draughtsman, he applied circuit-schematic conventions to
the network: only horizontal, vertical and 45° line segments; the congested centre enlarged and the
periphery compressed; stations as evenly-spaced ticks regardless of true distance; geographic
surface detail discarded (the Thames survives as the lone landmark). It is "technically a diagram,
rather than a map"
([London Museum](https://www.londonmuseum.org.uk/collections/london-stories/harry-beck-revolutionised-tube-map/),
[London Transport Museum](https://www.ltmuseum.co.uk/collections/stories/design/transforming-tube-map-harry-becks-iconic-design)).
Management initially rejected it as too radical; the 1933 public printing vindicated it, Frank Pick
conceding it "a better map than any we have had so far"
([London Museum](https://www.londonmuseum.org.uk/collections/london-stories/harry-beck-revolutionised-tube-map/)).
Ken Garland's *Mr Beck's Underground Map* (1994) is the standard first-hand design history
([London Museum](https://www.londonmuseum.org.uk/collections/london-stories/harry-beck-revolutionised-tube-map/)).

**The glance device.** Ruthless subtraction. Beck answered exactly one question — "which line do I
take, and where do I change?" — and deleted every channel not serving it. Colour means line
identity and nothing else; a station is a tick unless it is an interchange; distance means nothing,
so it cannot be misread as meaning something. The lesson is not "draw 45° lines"; it is *choose the
single question, then delete the channels that don't answer it* **[synthesis, from the sources
above]**.

**Where it breaks down.** The subtraction has measurable costs. Zhan Guo's study of London
Underground path choice found map distance explains passengers' route decisions about **twice as
strongly as actual travel time**, even for riders using the system five days a week — the diagram's
distortions override lived experience (map distance correlates with real distance at only r = 0.22)
([Guo, *Mind the Map!*, Transportation Research Part A, 2011 — PDF](https://wagner.nyu.edu/files/faculty/publications/Mind_the_Map_Guo_Zhan_2010.pdf)).
Applied here: whatever a roadmap diagram makes look close *will be believed close*, whatever the
issue data says **[synthesis]**. The grammar also requires *lines* — long shared sequences with
few branchings. Research that borrowed the metaphor for information (Shahaf & Guestrin's "metro
maps of information") had to algorithmically *extract coherent linear storylines from a graph*
before the metaphor worked at all
([Shahaf, Guestrin & Horvitz, *Metro Maps of Information*](https://www.hyadatalab.com/papers/shahaf-maps.pdf)).
A wayfinder map is a shallow DAG with wide parallel frontiers, not a bundle of long lines — the
precondition mostly doesn't hold **[synthesis]**.

**Genre read.** "Transit map" instantly — which is the trap: a roadmap drawn this way reads as a
*clever infographic about a subway that doesn't exist*, a decorating genre (metro-map posters of
everything from film plots to the Milky Way) rather than a live instrument **[synthesis]**.

**Against the four states.** Nothing is native. Beck's diagram has no traveller, no past, no
frontier and no fog — it is a map of permanent infrastructure, the one thing a wayfinder map is
not. Its transferable asset is the design *method* (one question, delete the rest), not the visual
grammar.

---

## 3. Route cartography

### 3a. Minard's 1812 flow map

**What is encoded, where.** Charles Joseph Minard's 1869 *Carte figurative* of Napoleon's Russian
campaign encodes six variables in one image: army size as the **width** of the flow band (422,000
shrinking to 10,000), position as x/y geography, direction as colour (tan advance, black retreat),
plus date and temperature on a linked scale below the retreat
([Tufte, *The Visual Display of Quantitative Information*, discussed at
CMU's Sage project](https://www.cs.cmu.edu/afs/cs/project/sage-1/www/project/samples/sage/Minard-Tufte.html);
[Heiss's channel-by-channel breakdown](https://www.andrewheiss.com/blog/2017/08/10/exploring-minards-1812-plot-with-ggplot2/)).
Tufte judged it "may well be the best statistical graphic ever drawn"
([datavizblog on Tufte's analysis](https://datavizblog.com/2013/05/15/dataviz-history-edward-tufte-charles-minard-napoleon-and-the-russian-campaign-of-1812-part-1/)).

**The glance device.** The thinning band. Magnitude is fused to the path itself — you cannot see
the route without simultaneously seeing the cost of travelling it. No legend mediates: thinner *is*
fewer.

**Where it breaks down.** It is purely retrospective. Minard drew it decades after the fact; the
grammar has no channel for options, intentions or unknowns — the future does not appear on it at
all. It also handles only a couple of flows before bands occlude **[synthesis]**.

**Genre read.** "Historical chart / memorial." Its emotional register is elegy, not expedition.

**Against the four states.** Ground covered: the best encoding in this survey — a band that
visibly *carries its history*. The other three states: absent. **Transferable idea [synthesis]:**
the *trail behind the traveller can encode data* (e.g. thickness = tickets closed along that
branch), rather than being a uniform line.

### 3b. Strip maps and itineraries: Matthew Paris and Ogilby

**What is encoded, where.** Matthew Paris's itinerary maps (c. 1250) render London→Jerusalem as
vertical strips read bottom-to-top: each column is a sequence of cities drawn as architectural
vignettes, joined by a drawn road, with a day's travel as the implicit unit between stops; London
sits bottom-left, the Holy Land terminates the sequence
([Univ. of Nottingham, *Jerusalem: Fall of a City* item page](http://jerusalem.nottingham.ac.uk/items/show/100);
[Smarthistory](https://smarthistory.org/matthew-pariss-itinerary-maps-from-london-to-palestine/)).
Scholars read them as instruments of *virtual pilgrimage* — a journey performed by eye from the
cloister ([The Pilgrim's Guide](https://thepilgrimsguide.com/projects/medieval-reinterpretation-of-the-holy-places-virtual-pilgrimage-matthew-pariss-itinerary-map-and-meditative-tools/)).
Ogilby's *Britannia* (1675), the first surveyed road atlas of Britain, industrialised the form: 100
plates, each road drawn as an unfurling **ribbon scroll** across six panels at one inch to the
mile, annotated with towns, bridges and landmarks; north varies per strip so the reader is always
oriented *in the direction of travel*, making it "a linear cartogram" descended from the Roman
itinerarium ([ICA Commission on Map Design, MapCarte 118](https://mapdesign.icaci.org/2014/04/mapcarte-118365-britannia-by-john-ogilby-1675/)).

**The glance device.** Linearisation plus a pinned destination. Everything irrelevant to *this
journey* is off the page; distance is uniform and honest; the destination is literally the top of
the scroll. The reader's position on the strip needs no explanation because the strip has only one
axis **[synthesis, from the sources above]**.

**Where it breaks down.** Branching. A strip map carries one route; Ogilby needed a hundred plates
for a road network. Parallel workstreams either become parallel strips (losing cross-dependencies)
or force merges the grammar can't draw. It is the grammar most at risk of degenerating into a
progress bar — which is the dashboard failure again **[synthesis]**.

**Genre read.** "Journey / pilgrimage / route" — the strongest genre signal in the survey. Nobody
has ever mistaken a strip map for an org chart.

**Against the four states.** Ground covered: native (the scroll behind you). Takeable edge: native
(the next stop on the ribbon). Blocked: weak (strictly sequential blocking only). Fog: surprisingly
natural — the scroll simply *hasn't been drawn* past a point; Paris's format even implies it, since
the strip exists only as far as it has been charted **[synthesis]**.

### 3c. Portolan charts

Late-13th-century Mediterranean sailing charts encode coastline and ports with obsessive fidelity
and leave the interior blank; the surface is webbed with **rhumb lines** radiating from compass
roses, which pilots used to lay a bearing from harbour to harbour
([Library of Congress research guide](https://guides.loc.gov/nautical-charts/portolan-charts);
[Britannica](https://britannica.com/technology/portolan-chart)). The glance device is *edge-only
knowledge*: the chart admits it knows the coast and not the interior — an honest boundary between
charted and uncharted drawn as a matter of course. Breakdown: no route memory, no state; it is
infrastructure for computing headings. Genre read: "old nautical chart." **Transferable idea
[synthesis]:** partial knowledge rendered as *detailed edge, empty interior* is a dignified,
non-gamey way to draw fog.

### 3d. Ski trail maps

**What is encoded, where.** A painted panorama of real terrain (James Niehues's ~255 hand-painted
resort maps are the canon), with the mountain deliberately distorted so every run faces the viewer
([Sidetracked interview with Niehues](https://www.sidetracked.com/fieldjournal/james-niehues-the-man-behind-the-maps/)).
Overlaid: named trails and a three-symbol difficulty code — green circle / blue square / black
diamond — designed for Disney's unbuilt Mineral King resort (shapes and colours chosen by testing
perceived softness/hardness) and adopted industry-wide by the NSAA in 1968
([SKI Magazine, "Signs of the Times"](https://www.skimag.com/uncategorized/signs-of-the-times/);
[snowslang history](https://snowslang.com/ski-trail-ratings/)).

**The glance device.** Niehues states his goal exactly: "to convey at an initial glance the
potential experience... to draw them into the scene to explore the possibilities; then clearly and
accurately guide them through their first chosen route and on to their next"
([Sidetracked](https://www.sidetracked.com/fieldjournal/james-niehues-the-man-behind-the-maps/)).
The whole possibility space is one picture; difficulty pre-attentively filters "runs I can take."
That is precisely a *frontier-first* reading: the map is organised around what you can do next
**[synthesis]**.

**Where it breaks down.** No state, no memory: the trail map doesn't know where you've been. And it
requires terrain — an invented mountain for a ticket graph is a large aesthetic commitment
**[synthesis]**.

**Genre read.** "Resort/adventure map" — invitation, exploration, play. Notably *not* a management
genre. **Transferable ideas [synthesis]:** (1) difficulty/size symbols on tickets, Disney-tested to
need no legend; (2) distortion in service of "every option faces the viewer."

---

## 4. Narrative and branching-story maps

**What is encoded, where.** Christian Swinehart's *One Book, Many Readings* visualised twelve
Choose-Your-Own-Adventure books as directed graphs: pages as nodes, choices as edges, endings
colour-graded from red (doom) to blue (triumph); arc diagrams over page order exposed how authors
"folded their nonlinear stories into a sequential medium," and animated traversals traced single
readings through the possibility space
([samizdat.co/cyoa](https://samizdat.co/cyoa/)). The related folk grammar is the storyline chart —
xkcd's "Movie Narrative Charts" ([xkcd 657](https://xkcd.com/657/)), bands of characters braiding
through time — later formalised as "storyline visualisation" in the literature.

**The glance device.** In Swinehart's plots, *ending colour density* reads at a glance (early CYOA
books are "awash in reds"; later ones funnel to a single good ending —
[samizdat.co/cyoa](https://samizdat.co/cyoa/)). In storyline charts, convergence of bands = things
coming together; that single intuition carries the whole grammar.

**Where it breaks down.** These are *analyses of* journeys, made for a reader standing outside all
of them at once. Swinehart's diagrams are compelling exactly because they show every path
simultaneously — the opposite of being *on* one. Density limit is severe past a few dozen nodes.

**Genre read.** "Data-art / literary analysis." A viewer admires it; they do not locate themselves
in it **[synthesis]**.

**Against the four states.** One genuinely relevant device: the red/blue *ending* colouring shows
that terminal states of a graph can be graded in value at a glance — but the wayfinder states are
about traversal, which this grammar externalises.

---

## 5. Project and dependency tooling — and why it reads as management

**What is encoded, where.** The Gantt chart (Henry Gantt, c. 1910s) puts tasks on rows and time on
the x-axis, duration as bar length. PERT (1958–59, Polaris programme) models "a network of
interrelated events to be achieved in proper ordered sequence," with time estimates on activities
([Malcolm, Roseboom, Clark & Fazar, *Operations Research* 7(5), 1959](https://pubsonline.informs.org/doi/10.1287/opre.7.5.646)).
CPM is its industrial twin: an arrow diagram whose "essential ingredient is a mathematical model"
of sequence, durations and costs, solved by network-flow methods
([Kelley & Walker, *Critical-Path Planning and Scheduling*, EJCC 1959](https://dl.acm.org/doi/10.1145/1460299.1460318)).

**The glance device (and its absence).** The Gantt bar's one glanceable fact is *when and how
long*. PERT/CPM diagrams have essentially none: they were built as **input to computation** — the
critical path is the *output of an algorithm*, not something a human reads off the picture
([Kelley & Walker](https://dl.acm.org/doi/10.1145/1460299.1460318)) **[the framing is synthesis;
the papers' computational purpose is explicit]**.

**Where it breaks down.** Tufte's critique of Gantt charts is blunt: most are "analytically thin,
too simple," and "about half the charts show their thin data in heavy grid prisons. For these
charts the main visual statement is the administrative grid prison, not the actual tasks contained
by the grid." Dependencies, when drawn, become "spaghetti diagrams"; and he notes most Gantt charts
serve *administrative reporting* rather than the people doing the work
([Tufte, *Project Management Graphics (or Gantt Charts)*](https://www.edwardtufte.com/notebook/project-management-graphics-or-gantt-charts/)).

**Why the genre reads as management — the structural diagnosis [synthesis].** Three causes, all
structural rather than cosmetic:
1. **Time is the axis.** A time axis asserts a schedule; a schedule asserts accountability to it.
   Wayfinder maps deliberately have no dates — borrowing any time-axis grammar smuggles dates back
   in as an implication.
2. **Rows are owners.** The row/lane device (Gantt rows, kanban columns) partitions work into
   parallel accountabilities. That is why the first prototype's columns read as kanban: columns
   *are* the kanban grammar, whatever the headers say.
3. **The viewer is above, not within.** Management artifacts survey all work symmetrically from
   outside. Journey grammars have a position, a direction and an asymmetry between behind and
   ahead. No traveller, no journey.

Generic dependency-graph viewers (build graphs, module graphs) share cause 3 and add force-directed
instability: no direction of travel, no persistent geography, hence "hairball," hence the dome
prototype's failure **[synthesis]**.

**Against the four states.** Blocked is the family's home turf — PERT exists *because* of blocking.
Everything else is absent or fake (percent-complete shading on a Gantt bar is the canonical
progress lie; Tufte's recommended fix is showing actual-vs-planned explicitly —
[Tufte](https://www.edwardtufte.com/notebook/project-management-graphics-or-gantt-charts/)).

---

## 6. Synthesis: which grammars can carry all four states

| Grammar | Ground covered | Takeable edge | Blocked | Fog | Naive genre read |
|---|---|---|---|---|---|
| Tech/skill tree | weak (filled nodes) | **native** (unlocked ring) | **native** (locked-behind-edge) | none — whole tree pre-charted | game UI / unlock chart |
| Campaign/run map | **native** (traced path) | **native** (reachable nodes) | good (further up the braid) | possible (Mario-style undrawn paths) | adventure route |
| Fog of war | **native** (revealed ground) | **native** (the reveal boundary) | none | **native — the only one** | strategy game |
| Beck/metro | none | none | none | none | transit infographic |
| Minard flow | **best in class** (thinning band) | none | none | none | historical memorial |
| Strip map/itinerary | **native** (scroll behind) | **native** (next stop) | weak (sequential only) | natural (scroll ends) | pilgrimage / route |
| Trail map | none | **native** (runs facing you, difficulty-coded) | weak | weak (paintable) | resort adventure |
| CYOA/storyline | trace of one reading | none | none | none | data-art |
| Gantt/PERT/CPM | fake (percent bars) | weak | **native** (its whole purpose) | none | management report |

Two conclusions fall out **[synthesis]**:

1. **No single grammar carries all four.** The best single-grammar coverage is the campaign/run
   map (3 native + fog achievable); fog of war is the only source for a true fourth state; the
   dependency family contributes the only honest "blocked-by-*that*" encoding.
2. **The genre-read column is decisive, not decorative.** The three grammars whose naive reading
   is a *journey* (campaign map, strip map, fog-of-war territory) are exactly the ones with a
   traveller, a direction, and an asymmetry between behind and ahead. That asymmetry — the past
   drawn differently from the future, and the unknown drawn differently from both — is the missing
   ingredient the first prototype round lacked: all three prototypes drew every ticket with equal
   ontological confidence, which is the signature of a management artifact.

---

## Shortlist of candidate grammars

Ordered by fit. These compose; the first two are natural partners rather than rivals.

### 1. Campaign-route map (Slay-the-Spire grammar: ascending braid, iconic nodes, destination pictured at the top)

- **Why it fits:** the only graph grammar whose naive reading is "a route being travelled." Three
  of the four states are native: traced path = ground covered, reachable nodes = takeable edge,
  higher-up nodes = chained-and-waiting, with the map's *destination drawn as a picture at the top*
  giving the wayfinder destination a literal home. Node icons remove the legend. Route-planning
  legibility is proven in the wild ([StS map](https://slaythespire.wiki.gg/wiki/Map_Generation)).
- **Risk:** the braid encodes *alternative* paths (choose one), while a frontier is *parallel*
  work (do all, eventually) — the grammar can miscommunicate "picking this ticket forfeits the
  others." Width is capped (~6 lanes) and wide shallow wayfinder maps may not braid well. Also
  StS pre-charts the whole act, so fog must be deliberately added, not inherited.

### 2. Fog of war over the route map (Empire/Warcraft II grammar: revealed ground, shroud, blackness)

- **Why it fits:** the only native encoding of "uncharted" in any surveyed domain, understood
  without explanation for fifty years ([Empire, 1977](https://lifeandtimes.games/episodes/files/23)).
  The two-tone version (black = never charted, shroud = charted but not current) exactly matches
  wayfinder's fog vs. stale-data distinction, and the reveal boundary *is* the frontier. Progress
  becomes territory gained — emotionally right for a solo effort.
- **Risk:** fog needs stable ground to cover; ticket graphs have no geography, so layout must be
  invented and — critically — kept stable across polls, or object permanence dies. Pastiche risk:
  rendered carelessly it reads as a game homage rather than an instrument. (The portolan device —
  detailed edge, empty interior — is the dignified alternative rendering:
  [LOC](https://guides.loc.gov/nautical-charts/portolan-charts).)

### 3. Itinerary strip map (Paris/Ogilby grammar: vertical ribbon toward a pinned destination)

- **Why it fits:** the strongest pure "journey" genre signal in the survey; destination pinned at
  the scroll's end, ground covered behind, next stop ahead, and fog for free — the ribbon simply
  isn't drawn past the charted point
  ([MapCarte on Ogilby](https://mapdesign.icaci.org/2014/04/mapcarte-118365-britannia-by-john-ogilby-1675/)).
  Cheap to keep stable (one axis), and honest about wayfinder's real shape when a map is mostly a
  sequence of decisions with small task clusters.
- **Risk:** branching is the grammar's known failure mode — wide parallel frontiers and
  cross-dependencies don't fit a ribbon; forced onto one it degenerates into a progress bar, which
  is the dashboard failure of round one wearing period costume.

### 4. Tech-tree grammar (locked/available/researched nodes) — as a *component*, not the frame

- **Why it fits:** the only grammar where *blocked* is the native, richest state — locked behind a
  visible prerequisite edge, read fluently by anyone who has played a strategy game
  ([Ghys](https://www.gamestudies.org/1201/articles/tuur_ghys)); its available/locked node
  states are exactly frontier/blocked.
- **Risk:** as the overall frame it reads as a possibility space, not a journey — no traveller, no
  trace, and the whole future drawn as confidently as the past, which is anti-fog. Johnson's
  determinism critique also warns what total pre-charting does to how a map *feels*
  ([Designer Notes](https://www.designer-notes.com/old-world-designer-notes-4-the-technology-deck/)).

### Explicitly not shortlisted

- **Beck/metro** — nothing native for any of the four states, hard precondition (long shared
  lines) that wayfinder DAGs don't meet ([Shahaf et al.](https://www.hyadatalab.com/papers/shahaf-maps.pdf)),
  and a proven capacity to override reality in users' heads
  ([Guo](https://wagner.nyu.edu/files/faculty/publications/Mind_the_Map_Guo_Zhan_2010.pdf)). Keep
  the *method* (one question, delete every non-answering channel), not the look.
- **Gantt/PERT/CPM** — reads as management for structural reasons (time axis, accountability rows,
  view-from-above) that restyling cannot remove; Tufte's "grid prison"
  ([Tufte](https://www.edwardtufte.com/notebook/project-management-graphics-or-gantt-charts/)).
- **Minard, CYOA/storyline** — retrospective/analytic stances; but steal Minard's device of a
  trail that thickens with what it carried, and Swinehart's graded ending colours, as components.

### The composite worth prototyping next **[synthesis]**

A route map read upward toward a pictured destination (grammar 1), with tech-tree node states for
frontier/blocked (grammar 4 as component), and the region beyond the charted tickets rendered as
fog rather than as confident empty canvas (grammar 2) — i.e. the map draws its own ignorance. The
strip-map grammar (3) is the fallback if real wayfinder maps turn out too linear for the braid to
earn its complexity.
