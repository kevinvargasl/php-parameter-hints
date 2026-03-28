import { describe, it, expect } from "vitest";
import {
    isLiteral,
    namesMatch,
    formatLabel,
    parseParamLabel,
    splitParams,
    parseHoverSignature,
} from "../src/helpers";

describe("isLiteral", () => {
    it("returns true for double-quoted strings", () => {
        expect(isLiteral('"hello"')).toBe(true);
    });

    it("returns true for single-quoted strings", () => {
        expect(isLiteral("'hello'")).toBe(true);
    });

    it("returns true for numbers", () => {
        expect(isLiteral("42")).toBe(true);
        expect(isLiteral("3.14")).toBe(true);
    });

    it("returns true for booleans", () => {
        expect(isLiteral("true")).toBe(true);
        expect(isLiteral("false")).toBe(true);
    });

    it("returns true for null", () => {
        expect(isLiteral("null")).toBe(true);
    });

    it("returns true for arrays", () => {
        expect(isLiteral("[]")).toBe(true);
    });

    it("returns false for empty text (non-variable expressions like calls)", () => {
        expect(isLiteral("")).toBe(false);
    });

    it("returns false for variable names", () => {
        expect(isLiteral("myVar")).toBe(false);
        expect(isLiteral("foo")).toBe(false);
    });
});

describe("namesMatch", () => {
    it("matches identical names", () => {
        expect(namesMatch("name", "name")).toBe(true);
    });

    it("matches case-insensitively", () => {
        expect(namesMatch("Name", "name")).toBe(true);
        expect(namesMatch("NAME", "name")).toBe(true);
    });

    it("ignores underscores", () => {
        expect(namesMatch("my_var", "myvar")).toBe(true);
        expect(namesMatch("my_var", "myVar")).toBe(true);
    });

    it("ignores hyphens", () => {
        expect(namesMatch("my-var", "myvar")).toBe(true);
    });

    it("returns false for different names", () => {
        expect(namesMatch("foo", "bar")).toBe(false);
    });

    it("returns false for empty strings", () => {
        expect(namesMatch("", "name")).toBe(false);
        expect(namesMatch("name", "")).toBe(false);
    });
});

describe("formatLabel", () => {
    it("returns the parameter name", () => {
        expect(formatLabel({ name: "foo" })).toBe("foo");
    });
});

describe("parseParamLabel", () => {
    it("parses simple $name", () => {
        expect(parseParamLabel("$name")).toEqual({
            name: "name",
            isVariadic: false,
        });
    });

    it("parses typed parameter", () => {
        expect(parseParamLabel("string $name")).toEqual({
            name: "name",
            isVariadic: false,
        });
    });

    it("parses nullable typed parameter", () => {
        expect(parseParamLabel("?string $name")).toEqual({
            name: "name",
            isVariadic: false,
        });
    });

    it("parses variadic parameter", () => {
        expect(parseParamLabel("...$args")).toEqual({
            name: "args",
            isVariadic: true,
        });
    });

    it("parses typed variadic parameter", () => {
        expect(parseParamLabel("int ...$values")).toEqual({
            name: "values",
            isVariadic: true,
        });
    });

    it("returns null for labels without $", () => {
        expect(parseParamLabel("name")).toBeNull();
        expect(parseParamLabel("")).toBeNull();
    });

    it("parses union type parameter", () => {
        expect(parseParamLabel("string|int $value")).toEqual({
            name: "value",
            isVariadic: false,
        });
    });

    it("parses array type parameter", () => {
        expect(parseParamLabel("string[] $items")).toEqual({
            name: "items",
            isVariadic: false,
        });
    });

    it("parses intersection type parameter (PHP 8.1)", () => {
        expect(parseParamLabel("Countable&Iterator $collection")).toEqual({
            name: "collection",
            isVariadic: false,
        });
    });
});

describe("splitParams", () => {
    it("splits simple params", () => {
        expect(splitParams("$a, $b, $c")).toEqual(["$a", " $b", " $c"]);
    });

    it("handles nested parentheses", () => {
        expect(splitParams("callable($a, $b), $c")).toEqual([
            "callable($a, $b)",
            " $c",
        ]);
    });

    it("handles nested brackets", () => {
        expect(splitParams("array<int, string> $a, $b")).toEqual([
            "array<int, string> $a",
            " $b",
        ]);
    });

    it("returns empty array for empty string", () => {
        expect(splitParams("")).toEqual([]);
    });

    it("handles unbalanced closing parens without going negative", () => {
        expect(splitParams("$a), $b")).toEqual(["$a)", " $b"]);
    });

    it("handles single param", () => {
        expect(splitParams("string $name")).toEqual(["string $name"]);
    });

    it("handles default value with closing paren in string", () => {
        expect(splitParams("string $param = ')', int $other")).toEqual([
            "string $param = ')'",
            " int $other",
        ]);
    });

    it("handles default value with comma in string", () => {
        expect(splitParams('string $param = ",", int $other')).toEqual([
            'string $param = ","',
            " int $other",
        ]);
    });

    it("handles escaped quotes in default value", () => {
        expect(splitParams("string $param = 'it\\'s', int $other")).toEqual([
            "string $param = 'it\\'s'",
            " int $other",
        ]);
    });
});

describe("parseHoverSignature", () => {
    it("parses function signature from hover markdown", () => {
        const md = "```php\nfunction test(int $a, int $b): int\n```";
        const result = parseHoverSignature(md, 2);
        expect(result).toEqual([
            { name: "a", isVariadic: false },
            { name: "b", isVariadic: false },
        ]);
    });

    it("parses method signature without function keyword", () => {
        const md =
            "```php\nMyClass::doStuff(string $name, int $count): void\n```";
        const result = parseHoverSignature(md, 2);
        expect(result).toEqual([
            { name: "name", isVariadic: false },
            { name: "count", isVariadic: false },
        ]);
    });

    it("expands variadic parameters", () => {
        const md = "function test(string ...$items): void";
        const result = parseHoverSignature(md, 3);
        expect(result).toEqual([
            { name: "items[0]", isVariadic: true },
            { name: "items[1]", isVariadic: true },
            { name: "items[2]", isVariadic: true },
        ]);
    });

    it("returns empty for no signature", () => {
        const md = "This is just some documentation text.";
        const result = parseHoverSignature(md, 1);
        expect(result).toEqual([]);
    });

    it("handles mixed regular and variadic params", () => {
        const md = "function test(int $first, string ...$rest): void";
        const result = parseHoverSignature(md, 4);
        expect(result).toEqual([
            { name: "first", isVariadic: false },
            { name: "rest[0]", isVariadic: true },
            { name: "rest[1]", isVariadic: true },
            { name: "rest[2]", isVariadic: true },
        ]);
    });

    it("handles callable type hints with nested parens", () => {
        const md =
            "function test(callable(int): bool $filter, string $name): void";
        const result = parseHoverSignature(md, 2);
        expect(result).toEqual([
            { name: "filter", isVariadic: false },
            { name: "name", isVariadic: false },
        ]);
    });

    it("handles default value with closing paren in string", () => {
        const md = "function test(string $param = ')', int $other): void";
        const result = parseHoverSignature(md, 2);
        expect(result).toEqual([
            { name: "param", isVariadic: false },
            { name: "other", isVariadic: false },
        ]);
    });

    it("handles default value with escaped quotes", () => {
        const md =
            'function test(string $param = "he said \\"hi\\"", int $other): void';
        const result = parseHoverSignature(md, 2);
        expect(result).toEqual([
            { name: "param", isVariadic: false },
            { name: "other", isVariadic: false },
        ]);
    });
});
