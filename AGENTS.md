# AGENTS.md

This file provides guidance to AI Agents when working with code in this repository.

## Commands

```bash
npm run build      # Bundle with esbuild (minified, dist/extension.js)
npm run watch      # Bundle in watch mode (no minification)
npm run lint       # Type-check with tsc (no emit)
npm test           # Run vitest (all tests, single run)
```

Run a single test file:
```bash
npx vitest run test/phpParser.test.ts
```

Publish to VS Code Marketplace:
```bash
npx @vscode/vsce publish
```

## Architecture

VS Code extension that provides inline parameter name hints for PHP function/method calls. Works with `.php` and `.blade.php` files.

**Data flow:** `extension.ts` registers the provider → VS Code calls `provideInlayHints` → `phpParser.ts` extracts call sites from the AST → `parameterResolver.ts` resolves parameter names via the language server → hints are rendered.

### Key modules

- **`types.ts`** — Core TypeScript interfaces: `CallSite`, `ArgumentInfo`, `ResolvedParameter`, `PhpParameterHintsConfig`.
- **`config.ts`** — Reads workspace settings via `getConfig()`. Called by the provider on each render.
- **`inlayHintsProvider.ts`** — Implements `InlayHintsProvider`. Orchestrates parsing, resolution, caching, and temp file management. For Blade files, writes cleaned PHP to a temp file so the language server can resolve signatures.
- **`phpParser.ts`** — Wraps `php-parser` to extract `CallSite[]` and local function definitions. Handles Blade: converts `@php`/`@endphp` to `<?php`/`?>`, strips non-PHP content (preserving line positions), and separately parses `{{ }}`/`{!! !!}` echo expressions.
- **`parameterResolver.ts`** — Resolves parameter names by first trying SignatureHelp, then falling back to Hover markdown parsing.
- **`helpers.ts`** — Pure functions for signature parsing (`extractParamString`, `splitParams`), literal detection, and name matching. Both `extractParamString` and `splitParams` share quote-tracking logic via `updateQuoteState`.
- **`cache.ts`** — Two-level cache: parse cache (AST per document version) and parameter cache (resolved params per call site, 120s TTL, LRU eviction at 200 entries per URI).

### Debouncing

`extension.ts` debounces document-change events with a 250ms timeout before invalidating the cache. Uses a `Map` of pending timeouts per URI to prevent thundering herd on rapid edits.

### Blade support strategy

Blade files can't be understood by PHP language servers directly. The extension:
1. Converts `@php`/`@endphp` directives to `<?php`/`?>` tags
2. Blanks non-PHP content while preserving line/column positions
3. Parses `{{ expr }}` and `{!! expr !!}` echo expressions separately, adjusting positions by accounting for the 6-char `<?php ` prefix
4. Injects echo content back into the cleaned code for language server resolution
5. Writes the result to a temp `.php` file on disk (not `openTextDocument`, which creates visible phantom documents)

### Position preservation

Line numbers and column offsets must match between original source and cleaned code. `stripNonPhp` replaces non-PHP content with spaces (keeping `\n`). `convertBladeDirectives` replaces entire lines to avoid character-count mismatches. Echo expression positions are calculated from the original code, not the converted code.

## Testing

Tests use Vitest. The `vscode` module is not available in tests — only pure logic modules (`phpParser`, `helpers`, `cache`) are tested. The provider and resolver require a running VS Code instance.

## Settings

All under `phpParameterHints.*`: `enabled` (default: true), `literalsOnly` (default: false), `collapseWhenEqual` (default: true).
