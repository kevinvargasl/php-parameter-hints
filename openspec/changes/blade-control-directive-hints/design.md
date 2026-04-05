## Context

`phpParser.ts` already handles two Blade expression forms:
- `@php`/`@endphp` blocks → converted to `<?php`/`?>` by `convertBladeDirectives`, then parsed as normal PHP
- `{{ expr }}` / `{!! expr !!}` echo expressions → extracted by `extractBladeEchoSites`, parsed separately with position adjustment

Control directives (`@foreach`, `@if`, `@elseif`, `@while`, `@for`) embed PHP expressions in their parentheses but are not currently handled. After `convertBladeDirectives` runs, the directive lines are left as-is, so `stripNonPhp` blanks them out and any function calls inside are invisible to the parser.

`extractBladeEchoSites` is the pattern to follow: regex-find the construct, extract inner content, parse with `<?php WRAPPER(content)`, adjust positions, push call sites.

## Goals / Non-Goals

**Goals:**
- Provide inlay hints for function calls inside `@foreach`, `@for`, `@while`, `@if`, and `@elseif` directive expressions
- Preserve line/column positions exactly so hints appear at the correct character in the source
- Integrate without modifying `parameterResolver.ts`, `inlayHintsProvider.ts`, or any public API

**Non-Goals:**
- Handling Blade directives that do not wrap PHP expressions (e.g., `@extends`, `@include`, `@section`)
- Handling `@else` or `@endXxx` (no expressions)
- Injecting directive content into `finalCleaned` (the language server does not need it for resolution; only `sites` matters)

## Decisions

### 1. Parse directive content separately (not via `convertBladeDirectives`)

Converting `@foreach(expr)` → `<?php foreach(expr) { ?>` inside `convertBladeDirectives` would shift column offsets for everything on that line, making position math unreliable (the `@foreach(` prefix is 9 chars; `<?php foreach(` is 14 chars — a 5-char shift that varies per directive). The echo approach avoids this by parsing each expression in isolation and applying a known prefix offset.

**Decision**: Add `extractBladeDirectiveSites`, mirroring `extractBladeEchoSites`. The function finds directive occurrences, extracts their inner expression, wraps it in valid PHP, parses it, and adjusts positions.

**Alternative considered**: Patch `convertBladeDirectives` and account for the shifting. Rejected because offset tracking becomes per-directive-per-line bookkeeping with many edge cases.

### 2. Balanced-paren matching for content extraction

A simple `[^)]*` regex fails on nested calls like `@foreach(array_map(fn($x) => $x, $items) as $v)`. We need to find the matching `)` for the opening `(` of the directive.

**Decision**: Implement `findMatchingParen(code, openPos)` that walks forward incrementing/decrementing depth. Applied once per directive match; the inner content is `code.substring(openPos + 1, closePos)`.

### 3. PHP wrapper per directive type

Each directive maps to a PHP control structure so the parser accepts it:

| Directive | PHP wrapper |
|---|---|
| `@if(E)` / `@elseif(E)` | `<?php if(E) {}` |
| `@foreach(E)` | `<?php foreach(E) {}` |
| `@while(E)` | `<?php while(E) {}` |
| `@for(E)` | `<?php for(E) {}` |

**Prefix lengths** (used for column adjustment):
- `<?php if(` → 9
- `<?php foreach(` → 14
- `<?php while(` → 12
- `<?php for(` → 10

Column adjustment on line 0 of the parsed result: `parsedChar - prefixLen + contentStartCol`.

### 4. `hasBladeSyntax` update

The early-exit guard must recognise control directives so the new extraction step is reached.

**Decision**: Extend the check with `/@(foreach|for|while|if|elseif)\s*\(/.test(code)`.

## Risks / Trade-offs

- **Nested parentheses in strings** → The balanced-paren walker does not skip string literals, so a `)` inside a string like `@if(str_contains($s, ')'))` would cause an early stop. Mitigation: `suppressErrors: true` on the parser means a malformed snippet just produces no call sites rather than crashing. This edge case is unusual in practice.
- **Performance** → One extra regex scan + one `parser.parseCode` call per directive per file render. Directives are typically few; cost is negligible compared to the existing echo extraction.
- **No `finalCleaned` injection** → Directive content is not injected back into the temp file sent to the language server, so SignatureHelp cannot fire inside directive expressions. Hover fallback still works for any calls that survive that path. This is the same limitation that exists for echo expressions today.

## Open Questions

*(none)*
