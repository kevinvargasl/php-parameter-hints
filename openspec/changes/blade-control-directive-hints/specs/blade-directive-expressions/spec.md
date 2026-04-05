## ADDED Requirements

### Requirement: Detect control directives as Blade syntax
The system SHALL recognise files containing `@foreach`, `@for`, `@while`, `@if`, or `@elseif` directives as containing Blade syntax, triggering the Blade processing path.

#### Scenario: File with @foreach is treated as Blade
- **WHEN** `parsePhp` is called with code containing `@foreach(...)`
- **THEN** the Blade processing path executes (directive extraction runs)

#### Scenario: File with only @if is treated as Blade
- **WHEN** `parsePhp` is called with code containing `@if(...)` but no `@php` or `{{`
- **THEN** the Blade processing path executes

### Requirement: Extract call sites from @if and @elseif expressions
The system SHALL parse PHP expressions inside `@if(...)` and `@elseif(...)` and add any function call sites found to the result, with positions matching the original source.

#### Scenario: Function call inside @if
- **WHEN** the code contains `@if(myFunc($a, $b))`
- **THEN** a call site for `myFunc` is returned with arguments positioned at the correct line and column in the original source

#### Scenario: Function call inside @elseif
- **WHEN** the code contains `@elseif(check($x))`
- **THEN** a call site for `check` is returned with argument positioned correctly

#### Scenario: @if with no function calls
- **WHEN** the code contains `@if($user->isAdmin())`  and `isAdmin` has no arguments
- **THEN** no call sites are added (no arguments to hint)

### Requirement: Extract call sites from @foreach expressions
The system SHALL parse PHP expressions inside `@foreach(...)` and add any function call sites found, with positions matching the original source.

#### Scenario: Function call in @foreach collection
- **WHEN** the code contains `@foreach(getItems($filter) as $item)`
- **THEN** a call site for `getItems` is returned with `$filter` argument positioned at the correct column

#### Scenario: Nested function call in @foreach
- **WHEN** the code contains `@foreach(array_map(fn($x) => $x, $items) as $v)`
- **THEN** a call site for `array_map` is returned with correct positions

### Requirement: Extract call sites from @while and @for expressions
The system SHALL parse PHP expressions inside `@while(...)` and `@for(...)` and add any function call sites found.

#### Scenario: Function call inside @while
- **WHEN** the code contains `@while(hasNext($cursor))`
- **THEN** a call site for `hasNext` is returned with `$cursor` positioned correctly

#### Scenario: Function call inside @for
- **WHEN** the code contains `@for($i = 0; $i < count($items); $i++)`
- **THEN** a call site for `count` is returned with `$items` positioned correctly

### Requirement: Correct position alignment for directive call sites
The system SHALL compute line and character positions for directive call sites relative to the original source file, not the synthetic PHP wrapper string.

#### Scenario: Directive on line 0, column 0
- **WHEN** the code starts with `@if(fn($x))` on the first line
- **THEN** the argument `$x` has `line: 0` and `character` matching its column in the original string (not the synthetic wrapper)

#### Scenario: Directive on a later line with indentation
- **WHEN** a directive appears on line 5 indented by 4 spaces
- **THEN** all call site positions have `line` equal to 5 and `character` offset from the indentation column

### Requirement: Handle balanced parentheses in directive expressions
The system SHALL correctly extract expressions that contain nested function calls with their own parentheses.

#### Scenario: Nested parentheses in @if
- **WHEN** the code contains `@if(in_array($x, getList()))`
- **THEN** the full expression `in_array($x, getList())` is extracted and both `in_array` and `getList` call sites are returned

#### Scenario: Malformed directive does not crash
- **WHEN** a directive has unbalanced parentheses (e.g. `@if($x`)
- **THEN** `parsePhp` returns without throwing; existing call sites from other constructs are unaffected
