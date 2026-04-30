import { ResolvedParameter } from "./types";
import { CallSite } from "./types";

interface ParamCacheEntry {
    params: ResolvedParameter[];
    timestamp: number;
    docVersion: number;
}

interface ParseCacheEntry {
    sites: CallSite[];
    sitesByLine: Map<number, number[]>;
    definitions: Map<string, ResolvedParameter[]>;
    cleanedCode: string;
    docVersion: number;
}

interface InFlightCacheEntry {
    promise: Promise<ResolvedParameter[]>;
    docVersion: number;
}

const TTL_MS = 120_000;
const MAX_ENTRIES_PER_URI = 200;

export class ParameterCache {
    private store = new Map<string, Map<string, ParamCacheEntry>>();
    private parseCache = new Map<string, ParseCacheEntry>();
    private inFlight = new Map<string, Map<string, InFlightCacheEntry>>();

    private makeKey(name: string, line: number, character: number): string {
        return `${name}\0${line}\0${character}`;
    }

    get(uri: string, name: string, line: number, character: number, docVersion: number): ResolvedParameter[] | undefined {
        const uriMap = this.store.get(uri);
        if (!uriMap) return undefined;

        const key = this.makeKey(name, line, character);
        const entry = uriMap.get(key);
        if (!entry) return undefined;

        if (entry.docVersion !== docVersion || Date.now() - entry.timestamp > TTL_MS) {
            uriMap.delete(key);
            return undefined;
        }

        uriMap.delete(key);
        uriMap.set(key, entry);

        return entry.params;
    }

    set(uri: string, name: string, line: number, character: number, docVersion: number, params: ResolvedParameter[]): void {
        let uriMap = this.store.get(uri);
        if (!uriMap) {
            uriMap = new Map();
            this.store.set(uri, uriMap);
        }

        if (uriMap.size >= MAX_ENTRIES_PER_URI) {
            const firstKey = uriMap.keys().next().value;
            if (firstKey !== undefined) uriMap.delete(firstKey);
        }

        const key = this.makeKey(name, line, character);
        uriMap.set(key, { params, timestamp: Date.now(), docVersion });
    }

    getInFlight(uri: string, name: string, line: number, character: number, docVersion: number): Promise<ResolvedParameter[]> | undefined {
        const uriMap = this.inFlight.get(uri);
        if (!uriMap) return undefined;

        const key = this.makeKey(name, line, character);
        const entry = uriMap.get(key);
        if (!entry) return undefined;

        if (entry.docVersion !== docVersion) {
            uriMap.delete(key);
            return undefined;
        }

        return entry.promise;
    }

    setInFlight(
        uri: string,
        name: string,
        line: number,
        character: number,
        docVersion: number,
        promise: Promise<ResolvedParameter[]>,
    ): void {
        let uriMap = this.inFlight.get(uri);
        if (!uriMap) {
            uriMap = new Map();
            this.inFlight.set(uri, uriMap);
        }

        const key = this.makeKey(name, line, character);
        uriMap.set(key, { promise, docVersion });
    }

    deleteInFlight(uri: string, name: string, line: number, character: number, docVersion: number): void {
        const uriMap = this.inFlight.get(uri);
        if (!uriMap) return;

        const key = this.makeKey(name, line, character);
        const entry = uriMap.get(key);
        if (!entry || entry.docVersion !== docVersion) return;

        uriMap.delete(key);
        if (uriMap.size === 0) {
            this.inFlight.delete(uri);
        }
    }

    getParsed(uri: string, docVersion: number): ParseCacheEntry | undefined {
        const entry = this.parseCache.get(uri);
        if (!entry || entry.docVersion !== docVersion) return undefined;
        return entry;
    }

    setParsed(uri: string, docVersion: number, sites: CallSite[], definitions: Map<string, ResolvedParameter[]>, cleanedCode: string): void {
        this.parseCache.set(uri, {
            sites,
            sitesByLine: this.buildSitesByLine(sites),
            definitions,
            cleanedCode,
            docVersion,
        });
    }

    getParsedSitesInRange(uri: string, docVersion: number, startLine: number, endLine: number): CallSite[] {
        const entry = this.getParsed(uri, docVersion);
        if (!entry) return [];

        const siteIndexes = new Set<number>();
        for (let line = startLine; line <= endLine; line++) {
            const indexes = entry.sitesByLine.get(line);
            if (!indexes) continue;
            for (const index of indexes) {
                siteIndexes.add(index);
            }
        }

        return Array.from(siteIndexes)
            .sort((a, b) => a - b)
            .map((index) => entry.sites[index]);
    }

    private buildSitesByLine(sites: CallSite[]): Map<number, number[]> {
        const sitesByLine = new Map<number, number[]>();

        for (let index = 0; index < sites.length; index++) {
            const lines = new Set<number>();
            for (const arg of sites[index].arguments) {
                lines.add(arg.line);
            }

            for (const line of lines) {
                let indexes = sitesByLine.get(line);
                if (!indexes) {
                    indexes = [];
                    sitesByLine.set(line, indexes);
                }
                indexes.push(index);
            }
        }

        return sitesByLine;
    }

    invalidate(uri: string): void {
        this.store.delete(uri);
        this.parseCache.delete(uri);
        this.inFlight.delete(uri);
    }

    clear(): void {
        this.store.clear();
        this.parseCache.clear();
        this.inFlight.clear();
    }
}
