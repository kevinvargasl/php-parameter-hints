## 1. Core implementation in phpParser.ts

- [] 1.1 Add `BLADE_DIRECTIVE_REGEX` constant matching `@foreach`, `@for`, `@while`, `@if`, `@elseif` with opening paren
- [] 1.2 Implement `findMatchingParen(code, openPos)` to locate the balanced closing `)` 
- [] 1.3 Implement `extractBladeDirectiveSites(code, sites)` — for each directive match: extract inner content, wrap in valid PHP, parse, adjust positions, push call sites
- [] 1.4 Update `hasBladeSyntax` to also return `true` when the code contains any supported control directive
- [] 1.5 Call `extractBladeDirectiveSites` from `parsePhp` alongside the existing echo extraction

## 2. Tests in phpParser.test.ts

- [] 2.1 Test `@if(fn($a, $b))` — call site with correct line/character for both arguments
- [] 2.2 Test `@elseif(check($x))` — call site with correct position
- [] 2.3 Test `@foreach(getItems($filter) as $item)` — call site for `getItems` with correct argument position
- [] 2.4 Test `@while(hasNext($cursor))` and `@for($i = 0; $i < count($items); $i++)` — call sites present
- [] 2.5 Test directive on a non-zero line with indentation — `line` and `character` are relative to original source
- [] 2.6 Test nested parens: `@if(in_array($x, getList($key)))` — both `in_array` and `getList` call sites returned
- [] 2.7 Test malformed directive (`@if($x` with no closing paren) — no exception thrown, empty result
