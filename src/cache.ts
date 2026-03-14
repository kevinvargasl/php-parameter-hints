import { ResolvedParameter } from "./types";
import { CallSite } from "./types";

interface ParamCacheEntry {
  params: ResolvedParameter[];
  timestamp: number;
  docVersion: number;
}

interface ParseCacheEntry {
  sites: CallSite[];
  definitions: Map<string, ResolvedParameter[]>;
  cleanedCode: string;
  docVersion: number;
}

const TTL_MS = 120_000;
const MAX_ENTRIES_PER_URI = 200;

export class ParameterCache {
  private store = new Map<string, Map<string, ParamCacheEntry>>();
  private parseCache = new Map<string, ParseCacheEntry>();

  private makeKey(name: string, line: number, character: number): string {
    return `${name}:${line}:${character}`;
  }

  get(
    uri: string,
    name: string,
    line: number,
    character: number,
    docVersion: number
  ): ResolvedParameter[] | undefined {
    const uriMap = this.store.get(uri);
    if (!uriMap) return undefined;

    const key = this.makeKey(name, line, character);
    const entry = uriMap.get(key);
    if (!entry) return undefined;

    if (entry.docVersion !== docVersion || Date.now() - entry.timestamp > TTL_MS) {
      uriMap.delete(key);
      return undefined;
    }

    // Move to end for LRU ordering
    uriMap.delete(key);
    uriMap.set(key, entry);

    return entry.params;
  }

  set(
    uri: string,
    name: string,
    line: number,
    character: number,
    docVersion: number,
    params: ResolvedParameter[]
  ): void {
    let uriMap = this.store.get(uri);
    if (!uriMap) {
      uriMap = new Map();
      this.store.set(uri, uriMap);
    }

    // Evict oldest entries if over limit
    if (uriMap.size >= MAX_ENTRIES_PER_URI) {
      const firstKey = uriMap.keys().next().value;
      if (firstKey !== undefined) uriMap.delete(firstKey);
    }

    const key = this.makeKey(name, line, character);
    uriMap.set(key, { params, timestamp: Date.now(), docVersion });
  }

  getParsed(uri: string, docVersion: number): ParseCacheEntry | undefined {
    const entry = this.parseCache.get(uri);
    if (!entry || entry.docVersion !== docVersion) return undefined;
    return entry;
  }

  setParsed(
    uri: string,
    docVersion: number,
    sites: CallSite[],
    definitions: Map<string, ResolvedParameter[]>,
    cleanedCode: string
  ): void {
    this.parseCache.set(uri, { sites, definitions, cleanedCode, docVersion });
  }

  invalidate(uri: string): void {
    this.store.delete(uri);
    this.parseCache.delete(uri);
  }

  clear(): void {
    this.store.clear();
    this.parseCache.clear();
  }
}
