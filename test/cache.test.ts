import { describe, it, expect, vi, beforeEach } from "vitest";
import { ParameterCache } from "../src/cache";

describe("ParameterCache", () => {
    let cache: ParameterCache;

    beforeEach(() => {
        cache = new ParameterCache();
    });

    it("returns undefined for missing entries", () => {
        expect(cache.get("file:///test.php", "foo", 0, 0, 1)).toBeUndefined();
    });

    it("stores and retrieves entries", () => {
        const params = [{ name: "a", isVariadic: false }];
        cache.set("file:///test.php", "foo", 0, 0, 1, params);
        expect(cache.get("file:///test.php", "foo", 0, 0, 1)).toEqual(params);
    });

    it("returns undefined when doc version changes", () => {
        const params = [{ name: "a", isVariadic: false }];
        cache.set("file:///test.php", "foo", 0, 0, 1, params);
        expect(cache.get("file:///test.php", "foo", 0, 0, 2)).toBeUndefined();
    });

    it("returns undefined after TTL expires", () => {
        vi.useFakeTimers();

        const params = [{ name: "a", isVariadic: false }];
        cache.set("file:///test.php", "foo", 0, 0, 1, params);

        // Entry exists before TTL
        expect(cache.get("file:///test.php", "foo", 0, 0, 1)).toEqual(params);

        // Advance past 120s TTL
        vi.advanceTimersByTime(121_000);

        expect(cache.get("file:///test.php", "foo", 0, 0, 1)).toBeUndefined();
        vi.useRealTimers();
    });

    it("invalidates all entries for a URI (O(1))", () => {
        const params = [{ name: "a", isVariadic: false }];
        cache.set("file:///test.php", "foo", 0, 0, 1, params);
        cache.set("file:///test.php", "bar", 5, 0, 1, params);
        cache.set("file:///other.php", "baz", 0, 0, 1, params);

        cache.invalidate("file:///test.php");

        expect(cache.get("file:///test.php", "foo", 0, 0, 1)).toBeUndefined();
        expect(cache.get("file:///test.php", "bar", 5, 0, 1)).toBeUndefined();
        expect(cache.get("file:///other.php", "baz", 0, 0, 1)).toEqual(params);
    });

    it("clears all entries", () => {
        const params = [{ name: "a", isVariadic: false }];
        cache.set("file:///a.php", "foo", 0, 0, 1, params);
        cache.set("file:///b.php", "bar", 0, 0, 1, params);

        cache.clear();

        expect(cache.get("file:///a.php", "foo", 0, 0, 1)).toBeUndefined();
        expect(cache.get("file:///b.php", "bar", 0, 0, 1)).toBeUndefined();
    });

    it("uses unique keys for different positions", () => {
        const params1 = [{ name: "a", isVariadic: false }];
        const params2 = [{ name: "b", isVariadic: false }];
        cache.set("file:///test.php", "foo", 0, 0, 1, params1);
        cache.set("file:///test.php", "foo", 5, 10, 1, params2);

        expect(cache.get("file:///test.php", "foo", 0, 0, 1)).toEqual(params1);
        expect(cache.get("file:///test.php", "foo", 5, 10, 1)).toEqual(params2);
    });
});

describe("ParameterCache - parse result caching", () => {
    let cache: ParameterCache;

    beforeEach(() => {
        cache = new ParameterCache();
    });

    const sites = [
        {
            name: "test",
            namePosition: { line: 0, character: 0 },
            arguments: [{ line: 0, character: 5, isNamed: false, text: "1" }],
        },
    ];
    const defs = new Map([["test", [{ name: "a", isVariadic: false }]]]);

    it("returns undefined for uncached parse results", () => {
        expect(cache.getParsed("file:///test.php", 1)).toBeUndefined();
    });

    it("stores and retrieves parse results", () => {
        cache.setParsed("file:///test.php", 1, sites, defs, "<?php\ntest(1);");
        const result = cache.getParsed("file:///test.php", 1);
        expect(result?.sites).toEqual(sites);
        expect(result?.definitions).toEqual(defs);
        expect(result?.cleanedCode).toBe("<?php\ntest(1);");
    });

    it("returns undefined when doc version changes", () => {
        cache.setParsed("file:///test.php", 1, sites, defs, "<?php\ntest(1);");
        expect(cache.getParsed("file:///test.php", 2)).toBeUndefined();
    });

    it("invalidate clears parse results too", () => {
        cache.setParsed("file:///test.php", 1, sites, defs, "<?php\ntest(1);");
        cache.invalidate("file:///test.php");
        expect(cache.getParsed("file:///test.php", 1)).toBeUndefined();
    });
});
