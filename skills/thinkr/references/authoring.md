# Authoring a thinkr page

```html
<title>API Rate Limits</title>            <!-- a name of 2 to 4 words, first thing in the file -->
<style> /* optional page styles, using the tokens below */ </style>
<t-page mode="design" version="1">
  <header>
    <h1>API Rate Limits</h1>
    <p class="lede">One paragraph: what this is and why it matters.</p>
  </header>
  <section> <h2 id="flow">…</h2> … </section>
</t-page>
<script type="ts"> /* figure code, see figures.md */ </script>
```

`build.ts` adds the font link, the CSS and runtime (files published beside the page), the sounds and the library
URLs. Each `h2` becomes an entry in "On this page".

## The page

| Attribute | Use |
|---|---|
| `mode="design\|explain"` | Required. `design` adds the dock (progress, Send feedback, Approve design), saves answers for Claude, and shows its spec once there is one (`spec.md`). `plan`, its old name, still builds. |
| `version="N"` | Required. Start at 1; add 1 on each republish. The header shows it and every send names it. |
| `key="…"` | Optional storage key. Defaults to a slug of the `h1`. |

## Text

Plain HTML: `section`, `h2`–`h4`, `p`, `ul`, `ol`, `blockquote`, `table`, `pre`, `code`, `kbd`, `strong`, `em`, `a`.

| Element | Use |
|---|---|
| `<p class="lede">` | The summary under the `h1`. |
| `<a href="https://…">` | A link out. The runtime adds a small ↗ and opens it in a new tab. Link the first mention of every library, API, spec, file or source. |
| `<t-callout kind="note\|tip\|warn" label="…">` | A boxed aside with an icon. Use rarely. |
| `<t-refs><ul><li><a href>Title</a><small>Why open it</small></li></ul></t-refs>` | The sources list, at the end of the page. Each row shows the link's site. |
| `<pre data-title="file.ts" data-href="https://…#L10-L20"><code class="language-ts">` | Code with a header, a copy button and highlighting (done at build, any highlight.js language). `data-href` links the header to the real file. Escape `<` and `&`. |
| `<table>` | Scrolls sideways on phones. `class="num"` on a cell right-aligns a number in mono. |
| `$$ … $$`, `\[ … \]`, `\( … \)` | TeX, rendered to SVG at build (the page loads no math library). `\col{1}{x}` colors a term with `c1`; `\R`, `\N`, `\E` are defined. The build warns on a TeX error. |
| `<pre class="mermaid">` | A static [Mermaid](https://mermaid.js.org/intro/) diagram, drawn at build by [pele](https://pele.run) into SVG in the page's colors, light and dark, and boxed like a figure. Escape `<` and `&`. Mark nodes `:::new`, `:::changed` or `:::removed` to color them as a change; leave out `classDef` and `style`, whose colors do not follow the theme. The build stops on a diagram it cannot read. Prefer a stepped SVG figure when order matters. |

### Color

Five semantic colors: `c1` blue, `c2` amber, `c3` green, `c4` pink, `c5` violet. Use them for recurring things, the
same meaning everywhere: `<span class="c1">learning rate</span>` in text, `var(--c1)` in SVG, `\col{1}{\eta}` in math,
`fig.color('c1')` in a shader. Never let color be the only signal.

Tokens for page styles and SVG: `--bg`, `--fg`, `--fg-2`, `--muted-fg`, `--faint`, `--card`, `--muted`, `--border`,
`--border-strong`, `--primary`, `--primary-fg`, `--ok`, `--bad`, `--c1`…`--c5`, `--font`, `--mono`, `--radius`. Both
themes are handled; never write a literal color.

## Questions

```html
<t-question id="algorithm" type="single" recommended="bucket">
  <p>Which algorithm should count requests?</p>
  <t-option value="bucket">Token bucket<small>Allows short bursts, then a steady rate.</small></t-option>
  <t-option value="fixed">Fixed window<small>Simplest. Lets a client double the limit at a minute boundary.</small></t-option>
</t-question>
```

| Attribute | Use |
|---|---|
| `id` | Required, stable across versions. Letters, digits, `-`, `_`, `.`. |
| `type="single"` | One answer (radio). The default. |
| `type="multi"` | Any number of answers (checkboxes). Add `max="2"` to cap it; the hint reads "Choose up to 2". |
| `type="text"` | A free answer. `placeholder` sets the hint. |
| `recommended="value"` | Your pick, shown with a badge. Always set it in a design. |
| `toc="Counting algorithm"` | The question's 2 to 4 word label under its section in "On this page". Without it the question text is cut to fit. |
| `answer="value"` or `answer="a,c"` | Makes it a self-check (explainers): **Check** marks right and wrong options and opens the `<t-explain>`. No Other row. |
| `no-other` | Removes the Other row (designs get Other with a text field by default). |

- The first `<p>` is the question: one sentence that names the decision.
- Each `<t-option value>` keeps its `value` across versions. `value="other"` is reserved.
- In a design, each choice question has **Add a note** for the reader's reason.
- `<t-explain>` inside a self-check holds the explanation shown after **Check**.
