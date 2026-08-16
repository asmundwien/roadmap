# Research: markdown for the panel — the options

Resolves [#27](https://github.com/asmundwien/roadmap/issues/27), child of
[Roadmap v4: the panel (#25)](https://github.com/asmundwien/roadmap/issues/25). Question: how should
the Panel render GitHub issue markdown — ticket bodies, decision gists, the map's parsed sections,
and fog/scope item text?

**Verdict up front: `react-markdown` + `remark-gfm`.** One renderer serves every fragment the panel
shows — whole ticket bodies *and* the raw-markdown slices the server already cuts out of map bodies —
because it takes any markdown string and returns React elements. It is safe by default (raw HTML and
`javascript:` URLs come out inert, verified live), GFM-complete with one plugin, ships its own types,
runs under React 19 (verified), and needs zero Biome suppressions. The price is the biggest bundle of
the four (+47 KB gzip), acceptable for a local-first SPA that ships nowhere. GitHub's pre-rendered
`bodyHTML` is rejected as the primary path for a structural reason: the map body is parsed into
sections from the **raw** markdown (`apps/server/src/wayfinder/map-body.ts`), and whole-body HTML
cannot be sliced into those sections without parsing GitHub's undocumented markup. Details and
citations below.

All live verification was done 2026-08-17: package behaviour against the exact versions named below
(installed fresh from npm, run under Node 26 / React 19.2.8), bundle sizes measured with esbuild
0.28.2 (`--bundle --minify --format=esm`, React externalized, gzip at default level), and the
GraphQL claims against `api.github.com` authenticated as `asmundwien`.

---

## 1. What the panel actually renders

Two distinct shapes of input, and any answer must serve both:

- **Whole bodies**: `Ticket.body` — "the issue body as written — markdown, unrendered"
  (`packages/contracts/src/index.ts`), fetched by the server's map query and already on the wire.
  The prototype (`apps/web/src/views/map/prototype-map-child.tsx`, `TicketContent`) currently dumps
  it into a `<p>` as plain text.
- **Raw-markdown fragments**: everything `map-body.ts` slices out of the map issue's raw body —
  the destination prose, notes/scope bullets, fog patches, and decision gists
  (`parseDecision` splits `[Title](url) — gist` bullets). These are markdown *substrings*, produced
  server-side by line-level parsing, never whole documents.

What exists today is `stripInlineMarkdown` (`apps/web/src/views/gist.ts`): four regexes that flatten
links, bold, italic, and code ticks to their words — explicitly "display flattening, not a markdown
parser". The panel's one-line gists keep using it; the panel's *bodies* are what need a real
renderer.

The wire context (`apps/server/src/socket.ts`, `store.ts`): the snapshot is broadcast **whole** to
every client on every change, and change detection is `JSON.stringify` of everything the views can
see. Any field added per ticket is paid on every broadcast and every fingerprint.

## 2. Route 1 — a renderer dependency

Four candidates, measured and behaviour-tested against the versions npm resolves today.

### (a) Bundle size, measured

esbuild 0.28.2, `--bundle --minify --format=esm`, `react`/`react-dom`/`react/jsx-runtime` external,
gzip −6. (Bundlephobia was rate-limiting; these are direct measurements, which is better anyway.)
For scale: the app's current production JS is ~214 KB minified.

| Entry (what a GFM-complete setup imports)                  | Minified | Gzip    |
| ---------------------------------------------------------- | -------- | ------- |
| `react-markdown@10.1.0` + `remark-gfm@4.0.1`               | 156.0 KB | 47.2 KB |
| `react-markdown@10.1.0` alone (no GFM)                     | 117.6 KB | 36.3 KB |
| `marked@18.0.9`                                            | 42.3 KB  | 12.7 KB |
| `micromark@4.0.2` + `micromark-extension-gfm@3.0.0`        | 74.4 KB  | 21.1 KB |
| `micromark@4.0.2` alone (no GFM)                           | 53.3 KB  | 15.4 KB |
| `markdown-it@15.0.0` + `markdown-it-task-lists@2.1.1`      | 115.1 KB | 48.5 KB |

(micromark's own "±14kb" claim — <https://github.com/micromark/micromark> — is its brotli'd core
without the GFM extension; the table is what a real import graph costs.)

### (b) GFM coverage (task lists, strikethrough, tables, autolinks), verified live

- **marked**: all four work with zero config — GFM is the default (`gfm: true`,
  <https://marked.js.org/using_advanced#options>). Verified: tables, `~~strike~~`, `- [x]`
  checkboxes, and bare `www.` + `https://` autolinks all rendered out of the box.
- **react-markdown**: none without a plugin; `remark-gfm` "adds support for footnotes,
  strikethrough, tables, tasklists and URLs directly"
  (<https://github.com/remarkjs/react-markdown>). Verified: all four render with the plugin,
  task-list items even carrying GitHub-style `task-list-item` classes.
- **micromark**: none by default (verified: `- [ ]` and tables come out as literal text); with
  `micromark-extension-gfm` ("100% GFM") all four render. Two imports, both in the table above.
- **markdown-it**: tables and strikethrough are built in (verified); task lists need the
  `markdown-it-task-lists` plugin; autolinks need `linkify: true` **and** — verified live — bare
  `www.example.com` no longer matches at all under the bundled `linkify-it@6` even with
  `fuzzyLink: true` (`new LinkifyIt().test('see www.example.com now')` → `false`); only
  scheme-full URLs autolink. GitHub autolinks bare `www.`, so markdown-it diverges from GitHub's
  rendering here without extra work.

### (c) Raw HTML / sanitization defaults, verified live

Test input: `<img src=x onerror=alert(1)> <script>…</script>` and `[click](javascript:alert(1))`.

- **marked**: passes raw HTML through **verbatim** — the `onerror` image and the `<script>` tag
  survive into the output, and the `javascript:` href survives too. This is documented policy:
  "Marked does not sanitize the output HTML. Please use a sanitize library, like DOMPurify
  (recommended), sanitize-html or insane on the *output* HTML!"
  (<https://github.com/markedjs/marked>). Using marked honestly means adding DOMPurify (~7 KB gz)
  on top.
- **micromark**: safe by default — HTML comes out entity-encoded, `javascript:` hrefs come out as
  `href=""`. "micromark makes any markdown safe by default, even if HTML is embedded or dangerous
  protocols are used, as it encodes or drops them"; raw HTML is opt-in via `allowDangerousHtml`
  (<https://github.com/micromark/micromark#security>).
- **markdown-it**: safe by default — `html: false` is the default, and the raw HTML rendered as
  escaped text (verified). "Safe by default" (<https://github.com/markdown-it/markdown-it>).
- **react-markdown**: safe by default — "no `dangerouslySetInnerHTML` or XSS attacks"; raw HTML is
  escaped/ignored unless the `rehype-raw` plugin is added, and the default `urlTransform` empties
  dangerous protocols (<https://github.com/remarkjs/react-markdown>). Verified under React 19.2.8:
  the HTML rendered inert and `javascript:alert(1)` became `href=""`.

### (d) Output model — the React seam

This is the structural difference. **react-markdown returns React elements**; the other three return
**HTML strings**, which reach the DOM only through `dangerouslySetInnerHTML`. Two consequences:

- Biome's recommended preset (this repo's `biome.json` uses `"preset": "recommended"`) includes
  `security/noDangerouslySetInnerHtml`, so every injection site is a lint error needing a
  `biome-ignore` suppression — a permanent, repeated dishonesty marker in the views.
- react-markdown's `components` prop maps tags to components with full typing — the natural place
  to give every rendered link `target="_blank" rel="noreferrer"` (the panel's existing habit, see
  `GithubButton`) and to downshift headings (`h1`→`h3`) so a shouty ticket body can't outrank the
  panel's own chrome. String renderers do this with renderer overrides on the HTML string instead.

### (e) React 19 and TypeScript

- **react-markdown**: `peerDependencies` `react: ">=18"` — verified running under React 19.2.8.
  Ships its own `.d.ts` and exports `Options`, `Components`, `UrlTransform` types. ESM-only.
- **marked**: framework-free; ships `lib/marked.d.ts`. No React coupling to break.
- **micromark**: framework-free; ships its own `.d.ts` (the whole unified ecosystem is
  types-in-JSDoc, checked).
- **markdown-it**: v15 now bundles its own types (`dist/markdown-it.d.cts` — no more
  `@types/markdown-it`), but `markdown-it-task-lists` ships **no types** (needs the DefinitelyTyped
  package or a local declaration).

## 3. Route 2 — hand-rolling a subset renderer

What exists is 4 regexes of *flattening*. A subset **renderer** emitting React elements — headings,
bold/italic, links, inline + fenced code, lists, paragraphs — is a different animal:

- **Estimated shape**: a block pass (split on blank lines; classify heading / fence / bullet run /
  paragraph — `map-body.ts`'s `bulletItems` shows the flavour) plus an inline pass (tokenize
  `**` `*` `` ` `` `[…](…)` with precedence: code spans first, no emphasis inside code, escaping).
  Realistically 150–250 lines plus a serious test file.
- **What it would not handle**: nested lists, ordered lists' start numbers, tables, task lists,
  images, autolinks, blockquotes, reference links, backslash escapes, HTML entities, setext
  headings, lazy continuation — and above all CommonMark's emphasis rules (left/right flanking
  delimiter runs; the spec dedicates ~17 rules and hundreds of its ~650 examples to inline
  structure, <https://spec.commonmark.org/0.31.2/>). `**a *b** c*` will render *somehow*, and
  differently from GitHub.
- **The honesty problem**: this repo's habit is that partial data *says so* (`ticketsTruncated`,
  `missingSections`). A subset renderer fails silently — content using anything outside the subset
  renders wrong with no signal, and detecting "outside the subset" is itself a parsing problem.
  Upside: zero dependencies, zero bytes, elements not strings, and no sanitization question because
  it never interprets HTML. Downside: it is a small markdown engine to maintain forever, and its
  bugs masquerade as content.

## 4. Route 3 — GitHub's pre-rendered `bodyHTML`

**It exists.** Live schema introspection (2026-08-17): `Issue.bodyHTML: HTML!` — "The body rendered
to HTML" — alongside `body` ("the body of the issue") and `bodyText` (rendered to plain text).
Schema reference: <https://docs.github.com/en/graphql/reference/objects#issue>.

**What it returns**, fetched live for map #25: GitHub-flavored HTML with GitHub's own markup —
`dir="auto"` on every block, `class="notranslate"` on `<code>`, task-list classes, hovercard
attributes on mentions/refs. No CSS comes with it; the class names are GitHub-internal,
undocumented, and theirs to change. For #25: raw body 2,646 bytes → `bodyHTML` 3,148 bytes
(**1.19×**).

**Wire cost**: the snapshot already carries every ticket's raw body, is fingerprinted by
`JSON.stringify`, and is broadcast whole to every client on every change (`store.ts`, `socket.ts`).
Adding `bodyHTML` per ticket roughly **doubles the body payload** (raw + 1.2× raw) on every
broadcast — not fatal on localhost, but pure redundancy.

**The structural disqualifier**: the map body's sections are sliced from the **raw** markdown —
`map-body.ts` splits on `##` lines, strips `<!-- -->` comments, extracts bullets, and parses
decision bullets into title/url/gist. `bodyHTML` is one pre-rendered document; serving the panel's
per-section and per-item views (destination, one fog patch, one decision gist) from it would mean
slicing *HTML* along boundaries GitHub's markup doesn't guarantee — an HTML parser plus assumptions
about undocumented output. So even with `bodyHTML` on the wire, every parsed fragment still needs a
client-side markdown renderer; `bodyHTML` could only ever cover the whole-ticket-body case, leaving
two render paths where one suffices. (Rendering each fragment server-side via `POST /markdown` is
the same dead end with extra REST requests and latency per change.) And being an HTML string, it
still lands in React through `dangerouslySetInnerHTML` — see §2d.

## 5. Sanitization posture for this app

Threat model: local-only, single user, the content is the user's own issues, the token never enters
the browser. Near-zero — but not axiomatically zero: cross-repo blockers already appear in maps, a
repo could gain outside contributors, and issue bodies routinely quote pasted third-party text. The
honest posture costs nothing here: prefer the renderer whose *default* output is inert. With
react-markdown there is no `dangerouslySetInnerHTML` anywhere in the codebase, raw HTML in bodies
renders as visible text, and dangerous URL protocols are emptied by default — the residual risk is
whatever `rehype-raw` would add, so don't add it. marked is the one option that ships unsafe by
default and would need DOMPurify bolted on to make the same claim.

## 6. Theming the output

The app's two themes are CSS custom properties in `apps/web/src/index.css` (`:root` +
`prefers-color-scheme: dark`). react-markdown (and any client renderer) emits plain semantic
elements, so styling is one scoped block — `.pfl-md h1…h3, p, ul/ol, a, code, pre, blockquote,
table` — written once against existing tokens: `--wash` for code/pre backgrounds, `--edge` for
rules and table borders, `--muted` for blockquotes, the existing link treatment for `a`. Both themes
fall out of the tokens for free. The one option where theming is *harder* is `bodyHTML`: its hooks
are GitHub's class names, undocumented and drifting, or element selectors fighting `dir="auto"`
noise.

## 7. Biome / strict-TS friction, per option

- **react-markdown**: none found — ESM, own types, typed `components` map, no `any`, no
  suppressions.
- **marked / micromark / markdown-it**: each needs `dangerouslySetInnerHTML` at every render site →
  `security/noDangerouslySetInnerHtml` (in Biome's recommended preset) fires → per-site
  `biome-ignore`. markdown-it additionally needs types conjured for `markdown-it-task-lists`.
- **hand-rolled**: no lint friction; the friction is the engine itself (§3), including
  `noExcessiveCognitiveComplexity` warnings an inline tokenizer tends to earn.

## 8. Recommendation

**Adopt `react-markdown@10` + `remark-gfm@4`, no rehype plugins.** One renderer covers both input
shapes the panel has (§1): whole ticket bodies and every raw-markdown fragment the server already
slices — which `bodyHTML` structurally cannot serve (§4) and a hand-rolled subset serves only
dishonestly (§3). It is the only dependency option that emits React elements instead of an HTML
string, so the app keeps zero `dangerouslySetInnerHTML` and zero Biome suppressions (§2d, §7); it is
safe by default against raw HTML and `javascript:` URLs (verified, §2c); GFM matches GitHub's own
rendering with one plugin (§2b); types ship in-box and React 19 is verified (§2e). The cost is
honest: at 47.2 KB gzip it is the heaviest choice (~3.7× marked), a real but acceptable price for a
local-first SPA that ships nowhere — and it buys the remark/rehype seam if the panel ever wants
syntax highlighting or heading rewrites. Fallback if bundle weight ever becomes a constraint:
`marked` + DOMPurify + a suppressed injection site, at 4× less weight and 2× less honesty.

Implementation notes for the adopting ticket: wrap it once (a `PanelMarkdown` component owning the
`remarkPlugins`, a `components` map giving links `target="_blank" rel="noreferrer"` and downshifting
headings, and the `.pfl-md` style block against the §6 tokens); keep `stripInlineMarkdown` for
one-line gists — flattening is still the right tool there.
