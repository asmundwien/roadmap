# Color system principles

## Accessibility and color vision

WCAG 2.2 constrains color use, not palette size. Normal text needs a contrast ratio of at least
4.5:1, while large text needs at least 3:1, subject to the criterion's exceptions
([WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html#success-criterion)).
Visual information needed to identify an active control, its state, or a meaningful graphic needs
at least 3:1 contrast against adjacent colors, subject to the criterion's exceptions
([WCAG 2.2 SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html#success-criterion)).
Color cannot be the only visual means of conveying information, identifying an action, prompting a
response, or distinguishing an element
([WCAG 2.2 SC 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html#success-criterion)).
When meaning depends on identifying a particular hue, WCAG requires another visible indicator even
if the colors contrast with each other
([WCAG 2.2 SC 1.4.1 intent](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html#intent)).
These requirements apply to the rendered foreground and background pair, not to a swatch in
isolation
([WCAG 2.2 SC 1.4.3 intent](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html#intent)).

The Design Tokens Community Group format supports references, so several semantic tokens can resolve
to one base value
([DTCG format, aliases](https://www.designtokens.org/TR/2025.10/format/#alias-reference)).
It permits groups for naming and organization, but says tools must not infer a token's purpose or
type from its group
([DTCG format, groups and composite tokens](https://www.designtokens.org/TR/2025.10/format/#groups-vs-composite-tokens)).
Its naming rules govern valid paths and reserved characters rather than prescribing a semantic
vocabulary
([DTCG format, token names](https://www.designtokens.org/TR/2025.10/format/#name-and-value)).
Primer supplies the missing system policy by separating base, functional, and component or pattern
tokens. It keeps base colors out of product code and makes functional tokens respond to color mode
([Primer, color design tokens](https://primer.style/product/getting-started/foundations/color-usage/#color-design-tokens)).
Carbon follows the same role-first principle: token names describe UI roles, and themes change the
values assigned to those roles
([Carbon, implementing color](https://carbondesignsystem.com/elements/color/overview/#implementing-color)).

## There is no universal color count

None of the reviewed standards specifies a minimum, maximum, or ideal number of palette colors.
WCAG specifies contrast and redundant cues
([WCAG 2.2 SC 1.4.1](https://www.w3.org/TR/WCAG22/#use-of-color),
[SC 1.4.3](https://www.w3.org/TR/WCAG22/#contrast-minimum),
[SC 1.4.11](https://www.w3.org/TR/WCAG22/#non-text-contrast)), while DTCG specifies token structure,
groups, and references
([DTCG format](https://www.designtokens.org/TR/2025.10/format/#design-token)).
Official systems choose different system-specific counts. Radix defines 12 steps per scale and gives
each step a usage class
([Radix, understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)),
while Primer's neutral scales run from 0 through 13 and sit beside separate semantic roles
([Primer, neutral colors](https://primer.style/product/getting-started/foundations/color-usage/#neutral-colors),
[Primer, color roles](https://primer.style/product/getting-started/foundations/color-usage/#color-roles)).
Those counts describe their systems, not a general rule.

A small system should therefore count distinct visual jobs. It should not count names, because DTCG
aliases and Radix semantic aliases both allow several names to share one value
([DTCG format, aliases](https://www.designtokens.org/TR/2025.10/format/#alias-reference),
[Radix, semantic aliases](https://www.radix-ui.com/colors/docs/overview/aliasing#semantic-aliases)).
Add a base value only when a required role, interaction state, theme, contrast pair, or data
comparison cannot reuse an existing value. This is a project rule derived from the role-based
systems above, not a standards requirement.

## Recommended structure

Use two layers inside the color module.

1. Keep raw color values private. A raw scale may contain as many stops as the light and dark schemes
   need to satisfy tested pairings. Product code must not name pigments or scale steps. Primer uses
   this base-to-functional separation and reserves direct base-token use for higher-level tokens
   ([Primer, color design tokens](https://primer.style/product/getting-started/foundations/color-usage/#color-design-tokens)).
2. Expose semantic roles for `canvas`, `surface`, `foreground`, `muted-foreground`, `edge`, `focus`,
   and tone-specific foreground, surface, border, solid, and on-solid uses. Stable role names may
   resolve to different values in each scheme, as Carbon's themes do
   ([Carbon, implementing color](https://carbondesignsystem.com/elements/color/overview/#implementing-color)).

Define valid pairings as module invariants. Each text role names the surfaces on which it may appear.
Each border, focus, and graphical role names its adjacent colors. Verify every pairing independently
in light and dark schemes against the applicable WCAG threshold
([WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html#success-criterion),
[WCAG 2.2 SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html#success-criterion)).
Keep visible text, shape, fill, stroke pattern, or iconography as the meaning-bearing cue. Color may
reinforce it
([WCAG 2.2 SC 1.4.1 techniques](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html#techniques)).

The same semantic roles should feed HTML and SVG. HTML consumers apply module-owned classes or CSS
custom properties. SVG consumers apply the resolved role to `color`, `fill`, or `stroke`. Do not
create a second SVG palette. A mark may accept independent base and accent roles, but each input must
come from the same generic role vocabulary.

## Color spaces

DTCG color tokens declare an explicit `colorSpace` and component array, and may include a six-digit
sRGB hex fallback
([DTCG color format](https://www.designtokens.org/TR/2025.10/color/#format)).
CSS Color 4 defines `oklab()` and `oklch()` and describes Oklab as having better hue linearity,
hue uniformity, and chroma uniformity than CIE LCH
([CSS Color 4, Oklab and OkLCh](https://www.w3.org/TR/css-color-4/#ok-lab)).
CSS Color 4 also notes that equal HSL lightness does not produce equal perceived lightness across
hues
([CSS Color 4, HSL disadvantages](https://www.w3.org/TR/css-color-4/#the-hsl-notation)).
Use OKLCH as an authoring aid when it makes ramps easier to control, but ship explicit sRGB fallbacks
and test the final rendered pairs. DTCG warns that color-space conversion and gamut mapping can alter
appearance
([DTCG color, gamut mapping](https://www.designtokens.org/TR/2025.10/color/#gamut-mapping)), and
WCAG 2.2 contrast remains a separate requirement based on the rendered pair
([WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)).

## Implications for Roadmap

The sources do not determine Roadmap's target count. The current interface needs three public
tones, one for each generic visual job that remains after category colors move back to text and
geometry:

```ts
type Tone = 'neutral' | 'accent' | 'critical'
```

`neutral` carries no signal. `accent` marks emphasis, activity, or selection without implying an
outcome. `critical` marks blocked, erroneous, or destructive states. Current uses of positive,
caution, informative, violet, and teal colors do not need separate public tones because their text,
glyphs, fill patterns, corner counts, or line styles already carry the distinction.

Keep five authored colors per scheme: canvas, ink, muted ink, accent, and critical. Derive
separators, washes, route lines, control boundaries, focus indicators, soft tone surfaces, and
on-solid colors from those anchors. Derived roles still need independent contrast checks, but they
do not become caller-selectable colors.

Views map domain facts to `Tone` at the domain-to-presentation seam. Reusable modules never accept
domain terms, pigment names, or raw color values. Badges keep visible text as their meaning-bearing
cue. Marks accept one tone and keep meaning in fill, glyph, corner, and line geometry; their renderer
owns any contrasting knockout needed between adjacent SVG layers. Every supported foreground and
background pair must pass in both schemes, and HTML and SVG consumers use the same role mapping.
