import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CallSite, ResolvedParameter, PhpParameterHintsConfig } from "./types";
import { parsePhp } from "./phpParser";
import { resolveParameters } from "./parameterResolver";
import { ParameterCache } from "./cache";
import { getConfig } from "./config";
import { isLiteral, namesMatch, formatLabel } from "./helpers";

export class PhpInlayHintsProvider implements vscode.InlayHintsProvider {
    private cache = new ParameterCache();
    private config: PhpParameterHintsConfig = getConfig();
    private tempFiles = new Map<string, { path: string; version: number }>();
    private tempDir: string | undefined;

    private _onDidChangeInlayHints = new vscode.EventEmitter<void>();
    readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

    fireRefresh(): void {
        this.config = getConfig();
        this.cache.clear();
        this._onDidChangeInlayHints.fire();
    }

    invalidateDocument(uri: vscode.Uri): void {
        const uriStr = uri.toString();
        this.cache.invalidate(uriStr);
        const temp = this.tempFiles.get(uriStr);
        if (temp) {
            try {
                fs.unlinkSync(temp.path);
            } catch {
                /* ignore */
            }
            this.tempFiles.delete(uriStr);
        }
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
            resolveUri = this.getTempPhpUri(uriStr, docVersion, cleanedCode);
        }

        const visibleSites = callSites.filter((site) =>
            site.arguments.some(
                (arg) =>
                    arg.line >= range.start.line && arg.line <= range.end.line,
            ),
        );

        if (visibleSites.length === 0) return [];

        const hints: vscode.InlayHint[] = [];

        for (const site of visibleSites) {
            if (token.isCancellationRequested) return [];

            const params = await this.resolveForSite(
                site,
                resolveUri,
                uriStr,
                docVersion,
                token,
                localDefs,
            );

            if (token.isCancellationRequested) return [];
            if (params.length === 0) continue;

            this.buildHints(site, params, config, hints);
        }

        return hints;
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
        let params = this.cache.get(
            cacheUri,
            site.name,
            site.namePosition.line,
            site.namePosition.character,
            docVersion,
        );

        if (!params) {
            if (token.isCancellationRequested) return [];

            params = await resolveParameters(
                resolveUri,
                site.namePosition,
                site.arguments[0],
                site.arguments.length,
            );

            if (params.length === 0) {
                const localParams = localDefs.get(site.name);
                if (localParams) {
                    params = expandVariadics(
                        localParams,
                        site.arguments.length,
                    );
                }
            }

            this.cache.set(
                cacheUri,
                site.name,
                site.namePosition.line,
                site.namePosition.character,
                docVersion,
                params,
            );
        }

        return params;
    }

    private ensureTempDir(): string {
        if (!this.tempDir) {
            this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "php-hints-"));
        }
        return this.tempDir;
    }

    private getTempPhpUri(uriStr: string, docVersion: number, cleanedCode: string): vscode.Uri {
        const existing = this.tempFiles.get(uriStr);
        if (existing && existing.version === docVersion) {
            return vscode.Uri.file(existing.path);
        }

        const dir = this.ensureTempDir();
        const tempPath =
            existing?.path ??
            path.join(
                dir,
                `${Date.now()}-${Math.random().toString(36).slice(2)}.php`,
            );
        fs.writeFileSync(tempPath, cleanedCode, {
            encoding: "utf-8",
            mode: 0o600,
        });
        this.tempFiles.set(uriStr, { path: tempPath, version: docVersion });
        return vscode.Uri.file(tempPath);
    }

    dispose(): void {
        this._onDidChangeInlayHints.dispose();
        this.cache.clear();
        for (const temp of this.tempFiles.values()) {
            try {
                fs.unlinkSync(temp.path);
            } catch {
                /* ignore */
            }
        }
        this.tempFiles.clear();
        if (this.tempDir) {
            try {
                fs.rmdirSync(this.tempDir);
            } catch {
                /* ignore */
            }
            this.tempDir = undefined;
        }
    }
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
