## Why

Blade control directives like `@foreach`, `@if`, `@elseif`, `@while`, and `@for` embed PHP expressions in their parentheses, but the extension currently ignores them — so function calls inside these directives get no parameter hints. Users writing Blade templates lose hints for a significant portion of their code.

## What Changes

- Parse PHP expressions from Blade control directives (`@foreach`, `@for`, `@while`, `@if`, `@elseif`) and inject them into the cleaned PHP for the language server
- Preserve original line/column positions so hints render at the correct locations in the source file
- Strip directive wrappers (e.g. `@foreach(` … `)`) while keeping the inner expression positioned correctly

## Capabilities

### New Capabilities

- `blade-directive-expressions`: Extract and position PHP expressions from Blade control directives so they are included in inlay hint resolution

### Modified Capabilities

*(none — no existing spec files)*

## Impact

- `src/phpParser.ts`: new parsing step alongside the existing echo-expression handling
- `test/phpParser.test.ts`: new test cases for directive extraction and position math
- No changes to `parameterResolver.ts`, `inlayHintsProvider.ts`, or any API surface
