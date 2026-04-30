import { describe, it, expect, vi, beforeEach } from "vitest";
import { ParameterCache } from "../src/cache";

const TEST_PARAMS = [{ name: "a", isVariadic: false }];

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

describe("ParameterCache - in-flight caching", () => {
    let cache: ParameterCache;

    beforeEach(() => {
        cache = new ParameterCache();
    });

    it("stores and retrieves in-flight promises", async () => {
        const promise = Promise.resolve(TEST_PARAMS);
        cache.setInFlight("file:///test.php", "foo", 0, 0, 1, promise);

        await expect(
            cache.getInFlight("file:///test.php", "foo", 0, 0, 1),
        ).resolves.toEqual(TEST_PARAMS);
    });

    it("returns undefined for in-flight entries when doc version changes", () => {
        const promise = Promise.resolve(TEST_PARAMS);
        cache.setInFlight("file:///test.php", "foo", 0, 0, 1, promise);

        expect(
            cache.getInFlight("file:///test.php", "foo", 0, 0, 2),
        ).toBeUndefined();
    });

    it("deletes matching in-flight entries", () => {
        const promise = Promise.resolve(TEST_PARAMS);
        cache.setInFlight("file:///test.php", "foo", 0, 0, 1, promise);

        cache.deleteInFlight("file:///test.php", "foo", 0, 0, 1);

        expect(
            cache.getInFlight("file:///test.php", "foo", 0, 0, 1),
        ).toBeUndefined();
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

    it("indexes parsed sites by visible line range", () => {
        const indexedSites = [
            {
                name: "foo",
                namePosition: { line: 0, character: 0 },
                arguments: [
                    { line: 0, character: 4, isNamed: false, text: "1" },
                    { line: 2, character: 4, isNamed: false, text: "2" },
                ],
            },
            {
                name: "bar",
                namePosition: { line: 1, character: 0 },
                arguments: [
                    { line: 1, character: 4, isNamed: false, text: "3" },
                ],
            },
        ];

        cache.setParsed(
            "file:///test.php",
            1,
            indexedSites,
            defs,
            "<?php\nfoo(1,\n2);\nbar(3);",
        );

        expect(
            cache.getParsedSitesInRange("file:///test.php", 1, 0, 0),
        ).toEqual([indexedSites[0]]);
        expect(
            cache.getParsedSitesInRange("file:///test.php", 1, 1, 1),
        ).toEqual([indexedSites[1]]);
        expect(
            cache.getParsedSitesInRange("file:///test.php", 1, 0, 2),
        ).toEqual(indexedSites);
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

    it("invalidate clears in-flight entries too", () => {
        cache.setInFlight(
            "file:///test.php",
            "foo",
            0,
            0,
            1,
            Promise.resolve(TEST_PARAMS),
        );

        cache.invalidate("file:///test.php");

        expect(
            cache.getInFlight("file:///test.php", "foo", 0, 0, 1),
        ).toBeUndefined();
    });
});
