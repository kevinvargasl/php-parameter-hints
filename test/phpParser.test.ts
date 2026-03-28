import { describe, it, expect } from "vitest";
import { parsePhp } from "../src/phpParser";

describe("extractCallSites", () => {
    it("extracts a simple function call", () => {
        const code = `<?php\ntest(1, 2);`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe("test");
        expect(sites[0].arguments).toHaveLength(2);
    });

    it("returns correct argument positions (0-based lines)", () => {
        const code = `<?php\ntest(1, 2);`;
        const sites = parsePhp(code).callSites;
        // Line 2 in source → 0-based line 1
        expect(sites[0].arguments[0].line).toBe(1);
        expect(sites[0].arguments[1].line).toBe(1);
    });

    it("extracts name position", () => {
        const code = `<?php\ntest(1, 2);`;
        const sites = parsePhp(code).callSites;
        expect(sites[0].namePosition.line).toBe(1);
        expect(sites[0].namePosition.character).toBe(0);
    });

    it("skips calls with no arguments", () => {
        const code = `<?php\ntest();`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(0);
    });

    it("extracts constructor calls (new)", () => {
        const code = `<?php\nnew Foo(1, "hello");`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe("Foo");
        expect(sites[0].arguments).toHaveLength(2);
    });

    it("extracts static method calls", () => {
        const code = `<?php\nFoo::bar(1);`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe("bar");
        expect(sites[0].arguments).toHaveLength(1);
    });

    it("extracts method calls on objects", () => {
        const code = `<?php\n$obj->method(1, 2, 3);`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe("method");
        expect(sites[0].arguments).toHaveLength(3);
    });

    it("extracts nested function calls", () => {
        const code = `<?php\nouter(inner(1), 2);`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(2);
        const names = sites.map((s) => s.name).sort();
        expect(names).toEqual(["inner", "outer"]);
    });

    it("detects PHP 8 named arguments", () => {
        const code = `<?php\ntest(name: "hello", age: 25);`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].arguments[0].isNamed).toBe(true);
        expect(sites[0].arguments[1].isNamed).toBe(true);
    });

    it("handles mixed named and positional arguments", () => {
        const code = `<?php\ntest(1, name: "hello");`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].arguments[0].isNamed).toBe(false);
        expect(sites[0].arguments[1].isNamed).toBe(true);
    });

    it("extracts argument text for variables", () => {
        const code = `<?php\ntest($foo, $bar);`;
        const sites = parsePhp(code).callSites;
        expect(sites[0].arguments[0].text).toBe("foo");
        expect(sites[0].arguments[1].text).toBe("bar");
    });

    it("extracts argument text for string literals", () => {
        const code = `<?php\ntest("hello");`;
        const sites = parsePhp(code).callSites;
        expect(sites[0].arguments[0].text).toBe('"hello"');
    });

    it("extracts argument text for number literals", () => {
        const code = `<?php\ntest(42);`;
        const sites = parsePhp(code).callSites;
        expect(sites[0].arguments[0].text).toBe("42");
    });

    it("extracts argument text for boolean literals", () => {
        const code = `<?php\ntest(true, false);`;
        const sites = parsePhp(code).callSites;
        expect(sites[0].arguments[0].text).toBe("true");
        expect(sites[0].arguments[1].text).toBe("false");
    });

    it("extracts argument text for null", () => {
        const code = `<?php\ntest(null);`;
        const sites = parsePhp(code).callSites;
        expect(sites[0].arguments[0].text).toBe("null");
    });

    it("extracts argument text for arrays", () => {
        const code = `<?php\ntest([1, 2]);`;
        const sites = parsePhp(code).callSites;
        expect(sites[0].arguments[0].text).toBe("[]");
    });

    it("returns empty text for call expressions as arguments", () => {
        const code = `<?php\ntest(foo());`;
        const sites = parsePhp(code).callSites;
        // outer call "test" has one arg with empty text (it's a call)
        const testSite = sites.find((s) => s.name === "test");
        expect(testSite).toBeDefined();
        expect(testSite!.arguments[0].text).toBe("");
    });

    it("returns empty array on invalid PHP", () => {
        const code = `not even php at all }{}{}{`;
        const sites = parsePhp(code).callSites;
        expect(sites).toEqual([]);
    });

    it("handles multiple calls in sequence", () => {
        const code = `<?php\nfoo(1);\nbar(2);\nbaz(3);`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(3);
    });

    it("handles chained method calls", () => {
        const code = `<?php\n$obj->first(1)->second(2);`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(2);
    });

    it("extracts call sites from Blade files with PHP block followed by HTML/Blade", () => {
        const code = [
            "<?php",
            "",
            "function test(int $a, int $b) {",
            "    return $a + $b;",
            "}",
            "",
            "test(1, 2);",
            "?>",
            "",
            "@php",
            '    $x = "hello";',
            "@endphp",
            "",
            '<div class="container">',
            "    {{ $x }}",
            "    @foreach ($items as $item)",
            "        <p>{{ $item }}</p>",
            "    @endforeach",
            "</div>",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe("test");
        // Line 7 in source (0-based: line 6)
        expect(sites[0].namePosition.line).toBe(6);
    });

    it("extracts call sites from multiple PHP blocks in Blade", () => {
        const code = [
            "<div>Hello</div>",
            "<?php",
            "foo(1);",
            "?>",
            "<div>Middle</div>",
            "<?php",
            "bar(2);",
            "?>",
            "<div>End</div>",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(2);
        const names = sites.map((s) => s.name).sort();
        expect(names).toEqual(["bar", "foo"]);
    });

    it("extracts call sites from @php/@endphp blocks", () => {
        const code = [
            "<div>Header</div>",
            "@php",
            "    $x = strtolower('HELLO');",
            "@endphp",
            "<div>Footer</div>",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe("strtolower");
        expect(sites[0].namePosition.line).toBe(2);
    });

    it("handles mixed <?php and @php blocks", () => {
        const code = [
            "<?php",
            "foo(1);",
            "?>",
            "<div>HTML</div>",
            "@php",
            "    bar(2);",
            "@endphp",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(2);
        const names = sites.map((s) => s.name).sort();
        expect(names).toEqual(["bar", "foo"]);
    });

    it("does not treat @phpunit or @phpdoc as @php directive", () => {
        const code = [
            "<div>@phpunit test</div>",
            "@php",
            "    test(1);",
            "@endphp",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe("test");
    });

    it("preserves line numbers when stripping Blade content", () => {
        const code = [
            "<div>Line 0</div>",
            "<div>Line 1</div>",
            "<div>Line 2</div>",
            "<?php",
            "test(1);",
            "?>",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].namePosition.line).toBe(4);
    });
});

describe("extractCallSites - Blade echo expressions", () => {
    it("extracts call sites from {{ expr }}", () => {
        const code = `<div>{{ trans('some.text') }}</div>`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe("trans");
        expect(sites[0].arguments).toHaveLength(1);
    });

    it("extracts call sites from {!! expr !!}", () => {
        const code = `<div>{!! strtolower('HELLO') !!}</div>`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe("strtolower");
    });

    it("ignores Blade comments {{-- --}}", () => {
        const code = `{{-- trans('ignore.me') --}}`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(0);
    });

    it("preserves correct line numbers for echo expressions", () => {
        const code = [
            "<div>Header</div>",
            "<p>{{ trans('some.text') }}</p>",
            "<div>Footer</div>",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].namePosition.line).toBe(1);
    });

    it("preserves correct column positions for echo expressions", () => {
        const code = `<div>{{ trans('some.text') }}</div>`;
        const sites = parsePhp(code).callSites;
        // {{ is at col 5-6, space at col 7, trans starts at col 8
        expect(sites[0].namePosition.character).toBe(8);
    });

    it("extracts nested calls inside echo expressions", () => {
        const code = `{{ strtolower(trans('key')) }}`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(2);
        const names = sites.map((s) => s.name).sort();
        expect(names).toEqual(["strtolower", "trans"]);
    });

    it("handles multiple echo expressions in one file", () => {
        const code = [
            "<div>{{ trans('a') }}</div>",
            "<div>{{ trans('b') }}</div>",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(2);
        expect(sites[0].namePosition.line).toBe(0);
        expect(sites[1].namePosition.line).toBe(1);
    });

    it("mixes PHP blocks and echo expressions", () => {
        const code = [
            "<?php",
            "foo(1);",
            "?>",
            "<div>{{ trans('key') }}</div>",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(2);
        const names = sites.map((s) => s.name).sort();
        expect(names).toEqual(["foo", "trans"]);
    });

    it("preserves positions for echo expressions after @php/@endphp blocks", () => {
        const code = [
            "@php",
            "    $x = 1;",
            "@endphp",
            "<div>{{ ucfirst(trans('key')) }}</div>",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(2);

        const ucfirstSite = sites.find((s) => s.name === "ucfirst")!;
        const transSite = sites.find((s) => s.name === "trans")!;
        expect(ucfirstSite).toBeDefined();
        expect(transSite).toBeDefined();
        expect(ucfirstSite.namePosition.line).toBe(3);
        expect(transSite.namePosition.line).toBe(3);
    });

    it("extracts call sites from files with only echo expressions (no PHP blocks)", () => {
        const code = [
            '<div class="container">',
            "    <p>{{ trans('hello') }}</p>",
            "</div>",
        ].join("\n");

        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(1);
        expect(sites[0].name).toBe("trans");
        expect(sites[0].namePosition.line).toBe(1);
    });

    it("ignores empty echo expressions", () => {
        const code = `{{ }}`;
        const sites = parsePhp(code).callSites;
        expect(sites).toHaveLength(0);
    });
});

describe("parsePhp - definitions", () => {
    it("extracts function definitions", () => {
        const code = `<?php\nfunction greet(string $name, int $age) { }`;
        const { definitions } = parsePhp(code);
        expect(definitions.get("greet")).toEqual([
            { name: "name", isVariadic: false },
            { name: "age", isVariadic: false },
        ]);
    });

    it("extracts method definitions from classes", () => {
        const code = `<?php\nclass Foo {\n  public function bar(int $x) { }\n}`;
        const { definitions } = parsePhp(code);
        expect(definitions.get("bar")).toEqual([
            { name: "x", isVariadic: false },
        ]);
    });

    it("detects variadic parameters in definitions", () => {
        const code = `<?php\nfunction test(string ...$items) { }`;
        const { definitions } = parsePhp(code);
        expect(definitions.get("test")).toEqual([
            { name: "items", isVariadic: true },
        ]);
    });

    it("extracts both call sites and definitions in one pass", () => {
        const code = [
            "<?php",
            "function add(int $a, int $b) { return $a + $b; }",
            "add(1, 2);",
        ].join("\n");

        const { callSites, definitions } = parsePhp(code);
        expect(callSites).toHaveLength(1);
        expect(callSites[0].name).toBe("add");
        expect(definitions.get("add")).toEqual([
            { name: "a", isVariadic: false },
            { name: "b", isVariadic: false },
        ]);
    });

    it("extracts definitions from Blade files with PHP blocks", () => {
        const code = [
            "<?php",
            "class MyComponent {",
            "  private function formatDecimal(float $value): string { }",
            "}",
            "?>",
            "<div>{{ $x }}</div>",
        ].join("\n");

        const { definitions } = parsePhp(code);
        expect(definitions.get("formatDecimal")).toEqual([
            { name: "value", isVariadic: false },
        ]);
    });
});
