# UIUX — DeepSeek Harness UI Component Catalog

[中文](README.md) | **English** | [Browse online](https://liuke101.github.io/dsh-UIUX/)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

This catalog is the product of a survey of the DeepSeek Harness Web client's React UI components: it collects every component's name, export identifier, appearance specimens and source location into an HTML catalog that can be browsed directly in a browser, and keeps the scripts and structured data needed to regenerate it.

The output is static HTML — double-click to open, no server and no network required.

## What's in the repository

| File | Contents |
|---|---|
| [index.html](index.html) | Overview: survey method, coverage statistics, component tiers, package distribution, reproduction commands. |
| [primitives.html](primitives.html) | Catalog of the base component library `ui-primitives`: live redraws of shared atoms, props tables and design tokens. |
| [product.html](product.html) | Product component catalog · conversation flow: messages, reasoning blocks, tool rows, the input editor and turn actions. |
| [product-shell.html](product-shell.html) | Product component catalog · shell and previews: app frame, sidebar, file actions, plus text / Office / image / web previews and attachments. |
| [product-dock.html](product-dock.html) | Product component catalog · dock and tools: dock panel and tabs, terminal and right rail, plus tool-call cards and render bindings. |
| [product-panels.html](product-panels.html) | Product component catalog · panels and overlays: task plans, goals, deliverables, plugin marketplace, schedule, workspace, plus dialogs and menus. |
| [product-settings.html](product-settings.html) | Product component catalog · settings and runtime views: the settings page skeleton and its row controls, account and onboarding, plus traces, subagents and workflows. |
| [tokens.html](tokens.html) | Design token reference: the `--dsw-*` static palette, semantic aliases, radii, typography, overlay borders and shadows, with light/dark values and reference counts. |
| [inventory.html](inventory.html) | Full inventory: export identifier, source location, props type, CSS class names and design tokens for every scanned component, filterable. |
| [data/components.json](data/components.json) | Machine-readable version of the component inventory (produced by the extraction script). |
| [data/tokens.json](data/tokens.json) | Machine-readable version of the design tokens (including each token's declaration site and the components that reference it). |
| [data/parts/](data/parts/) | Component entries (specimen HTML and metadata), split into files by batch: 388 entries / 967 specimens. |
| [data/ENTRY-SCHEMA.md](data/ENTRY-SCHEMA.md) | Entry authoring rules: field meanings and hard constraints. |
| [assets/](assets/) | Embedded CJK subset fonts (`cjk-400.woff2` / `cjk-500.woff2`, OFL-licensed subsets of Noto Sans SC). |
| [tools/](tools/) | Build and validation scripts: `extract.mjs`, `extract-tokens.mjs`, `build.mjs`, `font.mjs`, `validate.mjs`, `check.mjs`. |

## How the specimens are drawn

The specimens are neither screenshots nor approximate styles rewritten by eye from screenshots; they are rendered by **loading the component's own stylesheet source directly**:

1. Each component's `*.module.css` is inlined verbatim into a declarative shadow root (`<template shadowrootmode="open">`), so the component CSS applies verbatim and never leaks into the catalog page itself.
2. The page's `<body>` inlines the real theme stylesheets from `packages/client/ui-theme/src/styles/`, so specimens consume the real `--dsw-*` tokens. Custom properties inherit across the shadow boundary; clicking the theme button in the top-right corner (sun / moon icon) switches every specimen between the light and dark values. The choice is written to `localStorage` under `dsh-uiux-theme` and read back in the first child of `<body>`, so moving to another page keeps the same theme and there is no flash of light first. Rules in component CSS that target `body[data-ds-dark-theme]` are rewritten to `:host(...)` inside the shadow root, so the preview host carries the same attribute when the theme flips.
3. The specimen HTML uses the class names the component's `.tsx` actually passes to `clsx`, as determined by the extracted source structure; the build script performs only three mechanical rewrites: stripping `:global(...)` wrappers, changing `:root` / `html` / `body` selectors to `:host` (a shadow root has no document-level selectors), and inserting a preview reset, `button, input, select, textarea { font-family: inherit }`, before the component CSS — browsers' default form-control font contains no Chinese glyphs, which the real product covers with OS fonts while the catalog uses its embedded subset.
4. States that JavaScript alone produces (hover, expanded, open, focused) are presented as static approximations: each entry carries a small extra stylesheet that reproduces the visual effect of the real rules, and the specimen title is annotated accordingly.

Components that depend on a layout parent (sidebar, settings page, panels) get a classless wrapper in the specimen that declares only `width` / `display`. The specimen frame `.stage` is itself `position: relative` plus `isolation: isolate`: an absolutely positioned layer inside a component (`inset: 0`, for example `MenuSurface`'s `.material`) is normally contained by the positioned parent its caller provides; without that layer it would cover the whole viewport relative to the initial containing block — and a viewport-sized `backdrop-filter` makes Chromium skip painting the page entirely. Likewise, when a static snapshot in an entry pulls an overlay back into flow, use `position: relative` plus `inset: auto`, not `position: static`: `relative` returns it to flow while keeping the containing block that child layers need.

## Coverage

The inventory page covers every React component export in every `.tsx` under `packages/client/`, `packages/experimental/` and `packages/extensions/` — 601 in total; 388 of them have catalog entries and 967 live redrawn specimens:

- **Full product coverage**: 313 `product` components, 18 experimental-package components and 5 extension-package components, each export with its own entry (including `experimental/`'s voice input and conversation inspector, and `extensions/ui-cordis`'s plugin panel).
- **Base component library**: every visual export of `ui-primitives` has an entry, and the tokens page lists the `--dsw-*` tokens it consumes one by one.
- **Icons and artwork merged into families**: 199 icons and 10 brand artworks are merged into a handful of family entries (for example 8 permission icons in one entry, 5 plugin artworks in one entry); the glyphs are rendered side by side in a single specimen and labeled individually.

Because every specimen inlines its stylesheet source, a product page reaches a dozen-plus megabytes, so product components are split by area into five pages (conversation flow / shell and previews / dock and tools / panels and overlays / settings and runtime views); the "Product components" branch in the left navigation holds exactly those five pages.

How components are classified: `primitive` for shared atoms from `ui-primitives`; `icon` and `artwork` for glyphs and brand artwork; `product` for feature-package components; `experimental` and `extension` for experimental- and extension-package components. `packages/client/AGENTS.md` forbids feature packages from importing each other's components — `ui-primitives` is the only component source allowed to be reused across packages — so the catalog keeps the base library and the product components on two separate sets of pages.

## Regenerating

```sh
cd <this directory>
node tools/extract.mjs         # scan .tsx → data/components.json
node tools/extract-tokens.mjs  # parse ui-theme stylesheets → data/tokens.json
node tools/build.mjs           # assemble the nine pages
node tools/check.mjs           # entry validation + repository-reference rules + page artifact size
```

The first two scripts read source under `packages/client/`, so this directory must sit at the `UIUX/` location of a deepseek-harness checkout before you run them; `build.mjs` and `check.mjs` need only this directory's own data. The published copy (this repository's root, with no checkout above it) needs `--root <checkout>` to find the component stylesheets, otherwise entry validation reports every class name as undeclared:

```sh
node tools/build.mjs --root ~/deepseek-harness
node tools/check.mjs --root ~/deepseek-harness
```

Source links point at the upstream repository by default (`https://github.com/deepseek-ai/deepseek-harness/blob/master/<path>#L<line>`), so they work from the published copy; add `--source-base local` to switch back to relative paths for offline browsing inside a checkout. `check.mjs` verifies that these link targets are all tracked files of the current checkout — so the published copy never ships with dead links.

`check.mjs` does three things: validate each entry's required fields, class-name ownership, design tokens and source line number; confirm that the catalog contains no commit hashes or organization URLs, per the rules in `scripts/verify-repository-references.ts`; and report the size and specimen count of the nine pages.

The pages are in Chinese, and the build machine may not have a CJK font installed. The build script collects every Chinese character used on the pages into `data/cjk-charset.txt` and warns when coverage is missing; in that case, subset the font first and then rebuild:

```sh
mkdir -p /tmp/dsh-uiux-font && cd /tmp/dsh-uiux-font
npm install --cache ./.npm-cache subset-font
cd - && node <this directory>/tools/font.mjs --tools /tmp/dsh-uiux-font
node <this directory>/tools/build.mjs
```

`subset-font` is a build-time tool only and is deliberately not a repository dependency. On first run the font sources are downloaded from `notofonts/noto-cjk` into the `--cache` directory; `assets/*.woff2` are build outputs and can be committed alongside the catalog.

## Handling duplicate class names

A real build hashes each CSS Module class name, so `.root` in `ReasoningRow.module.css` and `.root` in `DisclosureRow.module.css` are two unrelated selectors. The catalog inlines stylesheets verbatim into a single shadow root, so it has to restore that isolation itself: when an entry lists two or more stylesheets, the build script rewrites class names per file to `c<index>-<original name>` (the index is the position in the `css` array), and rewrites the HTML class names to match.

Class-name ownership is resolved in this order: "the stylesheet with the same basename as the component source file" → "the first stylesheet in `css` that declares the class". When an element belongs to a non-primary stylesheet and the class name also exists in the primary one, the entry writes the prefixed class name directly and the build script leaves it as is; the rules are in [data/ENTRY-SCHEMA.md](data/ENTRY-SCHEMA.md) under "多张样式表与同名类" (multiple stylesheets and duplicate class names).

## Published copy

The catalog is also published at <https://github.com/liuke101/dsh-UIUX>, with GitHub Pages enabled for online browsing: <https://liuke101.github.io/dsh-UIUX/>. The `.nojekyll` file at the repository root disables Jekyll processing, so pages are served byte for byte. Each page has two entries at the top right: the GitHub cat icon points at this repository, and the sun / moon icon switches between light and dark.

The left navigation is a site tree: each of the nine pages carries its own in-page sections, the current page's branch is highlighted, and the section you are reading is marked in the tree (scrolling uses `scrollIntoView({ block: 'nearest' })` to bring it into the sidebar's own scroll area). The tree is computed once from `SITE` in `build.mjs` and written verbatim into all nine pages, so the sidebar keeps its shape as you turn pages — only the highlighted branch moves. Sections are plain anchor links on their own page and carry the file name when jumping across pages — which is why the separate "On this page" column was removed.

## Data fields

Each component record in `data/components.json` contains: `name`, `exportName`, `kind` (the classification), `package`, `file` and `line` (source location), `propsType`, `doc` (the source JSDoc), `cssModule`, `cssClasses`, `tokens` (design tokens referenced by the component's CSS) and `publicExport` (whether the package's `src/index.ts` exports it publicly).

Each entry record in `data/parts/*.json` contains: `id`, `name`, `exportName`, `zh`, `group`, `summary`, `source`, `css`, `tokens`, `specimens`, `props` and `notes`; field meanings are in [data/ENTRY-SCHEMA.md](data/ENTRY-SCHEMA.md).

## Notes

Each page embeds a CJK font subset inside `<head>`, so a single HTML file can be distributed on its own; the cost is about 760 KiB of font data (base64) per page, roughly 22 MiB across the nine pages. The inventory and token pages are large; browser search or the page's own filter box locates things faster than scrolling.

Catalog data is taken from a source snapshot in the workspace; the snapshot date is recorded at the top of each page, and regenerating brings the catalog back in line with the current source.

## License

The catalog pages, build scripts and structured data in this repository are open source under the MIT License; see [LICENSE](LICENSE) for the full text.

Copyright (c) 2026 LiuKe

Two kinds of embedded content keep their upstream licenses: the component stylesheets and source excerpts inlined verbatim in the specimens come from DeepSeek Harness (MIT), and the CJK subset fonts under `assets/` come from Noto Sans SC (SIL Open Font License 1.1).
