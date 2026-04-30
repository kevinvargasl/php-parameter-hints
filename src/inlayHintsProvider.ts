import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CallSite, ResolvedParameter, PhpParameterHintsConfig } from "./types";
import { parsePhp } from "./phpParser";
import {
    resolveParametersFromHover,
    resolveParametersFromSignatureHelp,
} from "./parameterResolver";
import { ParameterCache } from "./cache";
import { getConfig } from "./config";
import { isLiteral, namesMatch, formatLabel } from "./helpers";

const MAX_CONCURRENT_RESOLVES = 4;

const fsp = fs.promises;

interface TempFileEntry {
    path: string;
    version: number;
    cleanedHash: string;
}

export class PhpInlayHintsProvider implements vscode.InlayHintsProvider {
    private cache = new ParameterCache();
    private config: PhpParameterHintsConfig = getConfig();
    private tempFiles = new Map<string, TempFileEntry>();
    private tempDir: string | undefined;
    private tempDirPromise: Promise<string> | undefined;

    private _onDidChangeInlayHints = new vscode.EventEmitter<void>();
    readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

    fireRefresh(): void {
        this.config = getConfig();
        this.cache.clear();
        this._onDidChangeInlayHints.fire();
    }

    invalidateDocument(uri: vscode.Uri): void {
        this.cache.invalidate(uri.toString());
    }

    closeDocument(uri: vscode.Uri): void {
        const uriStr = uri.toString();
        this.cache.invalidate(uriStr);
        const temp = this.tempFiles.get(uriStr);
        if (!temp) return;

        this.tempFiles.delete(uriStr);
        void this.deleteTempFile(temp.path);
    }

    async provideInlayHints(document: vscode.TextDocument, range: vscode.Range, token: vscode.CancellationToken): Promise<vscode.InlayHint[]> {
        const config = this.config;
        if (!config.enabled) return [];

        const uri = document.uri;
        const uriStr = uri.toString();
        const docVersion = document.version;

        let parsed = this.cache.getParsed(uriStr, docVersion);
        if (!parsed) {
            const result = parsePhp(document.getText());
            this.cache.setParsed(
                uriStr,
                docVersion,
                result.callSites,
                result.definitions,
                result.cleanedCode,
            );
            parsed = {
                sites: result.callSites,
                sitesByLine: new Map(),
                definitions: result.definitions,
                cleanedCode: result.cleanedCode,
                docVersion,
            };
        }

        const {
            sites: callSites,
            definitions: localDefs,
            cleanedCode,
        } = parsed;

        let resolveUri = uri;
        if (document.languageId !== "php") {
            resolveUri = await this.getTempPhpUri(
                uriStr,
                docVersion,
                cleanedCode,
            );
        }

        const visibleSites = this.cache.getParsedSitesInRange(
            uriStr,
            docVersion,
            range.start.line,
            range.end.line,
        );

        if (visibleSites.length === 0) return [];

        const resolvedSites = await this.resolveVisibleSites(
            visibleSites,
            resolveUri,
            uriStr,
            docVersion,
            token,
            localDefs,
        );

        if (token.isCancellationRequested) return [];

        const hints: vscode.InlayHint[] = [];
        for (const { site, params } of resolvedSites) {
            if (token.isCancellationRequested) return [];
            if (params.length === 0) continue;
            this.buildHints(site, params, config, hints);
        }

        return hints;
    }

    private async resolveVisibleSites(
        visibleSites: CallSite[],
        resolveUri: vscode.Uri,
        cacheUri: string,
        docVersion: number,
        token: vscode.CancellationToken,
        localDefs: Map<string, ResolvedParameter[]>,
    ): Promise<Array<{ site: CallSite; params: ResolvedParameter[] }>> {
        const results = new Array<{ site: CallSite; params: ResolvedParameter[] }>(
            visibleSites.length,
        );
        const workerCount = Math.min(
            MAX_CONCURRENT_RESOLVES,
            visibleSites.length,
        );
        let nextIndex = 0;

        const workers = Array.from({ length: workerCount }, async () => {
            while (!token.isCancellationRequested) {
                const index = nextIndex++;
                if (index >= visibleSites.length) return;

                const site = visibleSites[index];
                const params = await this.resolveForSite(
                    site,
                    resolveUri,
                    cacheUri,
                    docVersion,
                    token,
                    localDefs,
                );

                results[index] = { site, params };
            }
        });

        await Promise.all(workers);

        return token.isCancellationRequested
            ? []
            : results.filter(
                  (result): result is { site: CallSite; params: ResolvedParameter[] } =>
                      result !== undefined,
              );
    }

    private buildHints(site: CallSite, params: ResolvedParameter[], config: PhpParameterHintsConfig, hints: vscode.InlayHint[]): void {
        for (let i = 0; i < site.arguments.length; i++) {
            const arg = site.arguments[i];
            const param = params[i];
            if (!param) break;

            if (arg.isNamed) continue;
            if (config.literalsOnly && !isLiteral(arg.text)) continue;
            if (config.collapseWhenEqual && namesMatch(arg.text, param.name))
                continue;

            const hint = new vscode.InlayHint(
                new vscode.Position(arg.line, arg.character),
                formatLabel(param) + ":",
                vscode.InlayHintKind.Parameter,
            );
            hint.paddingRight = true;
            hints.push(hint);
        }
    }

    private async resolveForSite(
        site: CallSite,
        resolveUri: vscode.Uri,
        cacheUri: string,
        docVersion: number,
        token: vscode.CancellationToken,
        localDefs: Map<string, ResolvedParameter[]>,
    ) {
        const { name } = site;
        const { line, character } = site.namePosition;

        let params = this.cache.get(
            cacheUri,
            name,
            line,
            character,
            docVersion,
        );

        if (params) {
            return params;
        }

        const inFlight = this.cache.getInFlight(
            cacheUri,
            name,
            line,
            character,
            docVersion,
        );
        if (inFlight) {
            return inFlight;
        }

        if (token.isCancellationRequested) return [];

        const localParams = localDefs.get(name);
        if (localParams) {
            params = expandVariadics(localParams, site.arguments.length);
            this.cache.set(
                cacheUri,
                name,
                line,
                character,
                docVersion,
                params,
            );
            return params;
        }

        const resolvePromise = (async () => {
            const resolved = await resolveParametersFromSignatureHelp(
                resolveUri,
                site.arguments[0],
                site.arguments.length,
            );
            if (resolved.length > 0) {
                return resolved;
            }

            return resolveParametersFromHover(
                resolveUri,
                site.namePosition,
                site.arguments.length,
            );
        })();

        this.cache.setInFlight(
            cacheUri,
            name,
            line,
            character,
            docVersion,
            resolvePromise,
        );

        try {
            params = await resolvePromise;
            this.cache.set(
                cacheUri,
                name,
                line,
                character,
                docVersion,
                params,
            );
            return params;
        } finally {
            this.cache.deleteInFlight(
                cacheUri,
                name,
                line,
                character,
                docVersion,
            );
        }
    }

    private async ensureTempDir(): Promise<string> {
        if (this.tempDir) {
            return this.tempDir;
        }

        if (!this.tempDirPromise) {
            this.tempDirPromise = fsp
                .mkdtemp(path.join(os.tmpdir(), "php-hints-"))
                .then((dir) => {
                    this.tempDir = dir;
                    return dir;
                })
                .finally(() => {
                    this.tempDirPromise = undefined;
                });
        }

        return this.tempDirPromise;
    }

    private async getTempPhpUri(
        uriStr: string,
        docVersion: number,
        cleanedCode: string,
    ): Promise<vscode.Uri> {
        const cleanedHash = hashString(cleanedCode);
        const existing = this.tempFiles.get(uriStr);
        if (existing) {
            if (existing.version === docVersion || existing.cleanedHash === cleanedHash) {
                existing.version = docVersion;
                if (existing.cleanedHash !== cleanedHash) {
                    existing.cleanedHash = cleanedHash;
                }
                return vscode.Uri.file(existing.path);
            }
        }

        const dir = await this.ensureTempDir();
        const tempPath = existing?.path ?? path.join(dir, `${hashString(uriStr)}.php`);
        await fsp.writeFile(tempPath, cleanedCode, {
            encoding: "utf-8",
            mode: 0o600,
        });
        this.tempFiles.set(uriStr, {
            path: tempPath,
            version: docVersion,
            cleanedHash,
        });
        return vscode.Uri.file(tempPath);
    }

    private async deleteTempFile(tempPath: string): Promise<void> {
        try {
            await fsp.unlink(tempPath);
        } catch {
            /* ignore */
        }
    }

    dispose(): void {
        this._onDidChangeInlayHints.dispose();
        this.cache.clear();

        const tempPaths = Array.from(this.tempFiles.values(), (temp) => temp.path);
        this.tempFiles.clear();
        void Promise.all(tempPaths.map((tempPath) => this.deleteTempFile(tempPath)));

        if (this.tempDir) {
            const dir = this.tempDir;
            this.tempDir = undefined;
            void fsp.rm(dir, { recursive: true, force: true }).catch(() => {
                /* ignore */
            });
        }
    }
}

function hashString(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function expandVariadics(params: ResolvedParameter[], argCount: number): ResolvedParameter[] {
    const result: ResolvedParameter[] = [];
    for (let i = 0; i < params.length; i++) {
        if (params[i].isVariadic) {
            const remaining = Math.min(argCount - i, 256);
            for (let j = 0; j < remaining; j++) {
                result.push({
                    name: `${params[i].name}[${j}]`,
                    isVariadic: true,
                });
            }
            break;
        }
        result.push(params[i]);
    }
    return result;
}
