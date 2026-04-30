// eslint-disable-next-line @typescript-eslint/no-require-imports
const phpParser = require("php-parser");
import { CallSite, ArgumentInfo, ResolvedParameter } from "./types";
import { updateQuoteState } from "./helpers";

const BLADE_ECHO_REGEX = /\{\{(?!--)([\s\S]{0,2000}?)\}\}|\{!!([\s\S]{0,2000}?)!!\}/g;
const BLADE_DIRECTIVE_REGEX = /@(foreach|for|while|elseif|if)\s*\(/g;
const NON_NEWLINE = /[^\n]/g;

const parser = new phpParser({
    parser: {
        php7: true,
        php8: true,
        suppressErrors: true,
        extractDoc: false,
        locations: true,
    },
    ast: {
        withPositions: true,
        withSource: false,
    },
});

export interface ParseResult {
    callSites: CallSite[];
    definitions: Map<string, ResolvedParameter[]>;
    cleanedCode: string;
}

function hasBladeSyntax(code: string): boolean {
    BLADE_DIRECTIVE_REGEX.lastIndex = 0;
    return (
        code.includes("@php") ||
        code.includes("{{") ||
        code.includes("{!!") ||
        BLADE_DIRECTIVE_REGEX.test(code)
    );
}

export function parsePhp(code: string): ParseResult {
    try {
        const isBlade = hasBladeSyntax(code);
        const converted = isBlade ? convertBladeDirectives(code) : code;
        const cleaned = stripNonPhp(converted);
        const ast = parser.parseCode(cleaned, "source.php");
        const sites: CallSite[] = [];
        const defs = new Map<string, ResolvedParameter[]>();
        visitAll(ast, sites, defs);

        let finalCleaned: string;
        if (isBlade) {
            const lineOffsets = buildLineOffsets(converted);
            const echoMatches = collectBladeEchoMatches(converted);
            const directiveMatches = collectBladeDirectiveMatches(converted);
            const fragments = collectBladeFragments(
                converted,
                lineOffsets,
                echoMatches,
                directiveMatches,
            );
            extractBladeFragmentSites(converted, fragments, sites);
            const echoInjected = injectBladeEchos(converted, cleaned, echoMatches);
            const directiveInjected = injectBladeDirectives(converted, echoInjected, directiveMatches);
            // Re-apply <?php prefix in case a directive at column 0 overwrote it
            finalCleaned = directiveInjected.length >= 5
                ? "<?php" + directiveInjected.substring(5)
                : directiveInjected;
        } else {
            finalCleaned = cleaned;
        }

        return {
            callSites: sites,
            definitions: defs,
            cleanedCode: finalCleaned,
        };
    } catch {
        return { callSites: [], definitions: new Map(), cleanedCode: code };
    }
}

function stripNonPhp(code: string): string {
    if (!code.includes("?>")) {
        if (code.includes("<?php")) return code;
        return blankOut(code, 0, code.length);
    }

    const result: string[] = [];
    let pos = 0;
    let inPhp = false;

    while (pos < code.length) {
        if (!inPhp) {
            const phpOpen = code.indexOf("<?php", pos);
            if (phpOpen === -1) {
                result.push(blankOut(code, pos, code.length));
                break;
            }
            result.push(blankOut(code, pos, phpOpen));
            inPhp = true;
            pos = phpOpen;
        } else {
            const phpClose = code.indexOf("?>", pos);
            if (phpClose === -1) {
                result.push(code.substring(pos));
                break;
            }
            result.push(code.substring(pos, phpClose + 2));
            inPhp = false;
            pos = phpClose + 2;
        }
    }

    return result.join("");
}

function convertBladeDirectives(code: string): string {
    const parts: string[] = [];
    let lineStart = 0;

    while (lineStart <= code.length) {
        const newlineIndex = code.indexOf("\n", lineStart);
        const lineEnd = newlineIndex === -1 ? code.length : newlineIndex;
        const line = code.substring(lineStart, lineEnd);
        const trimmed = line.trim();

        if (trimmed === "@php") {
            parts.push("<?php");
        } else if (trimmed === "@endphp") {
            parts.push("?>");
        } else {
            parts.push(line);
        }

        if (newlineIndex === -1) break;
        parts.push("\n");
        lineStart = newlineIndex + 1;
    }

    return parts.join("");
}

function blankOut(code: string, from: number, to: number): string {
    return code.substring(from, to).replace(NON_NEWLINE, " ");
}

interface BladeEchoMatch {
    index: number;
    fullLength: number;
    delimLen: number;
    contentStart: number;
    contentEnd: number;
    exprStart: number;
    exprEnd: number;
}

interface BladeDirectiveMatch {
    index: number;
    directive: string;
    openPos: number;
    closePos: number;
}

interface BladeFragment {
    index: number;
    contentStart: number;
    contentEnd: number;
    wrapperPrefix: string;
    wrapperSuffix: string;
    originalContentStartLine: number;
    originalContentStartCol: number;
    syntheticStartLine: number;
    syntheticEndLine: number;
    syntheticContentStartCol: number;
}

function collectBladeEchoMatches(code: string): BladeEchoMatch[] {
    BLADE_ECHO_REGEX.lastIndex = 0;
    const matches: BladeEchoMatch[] = [];
    let match;

    while ((match = BLADE_ECHO_REGEX.exec(code)) !== null) {
        const delimLen = match[0].startsWith("{!!") ? 3 : 2;
        const contentStart = match.index + delimLen;
        const contentEnd = match.index + match[0].length - delimLen;
        const trimmedRange = trimRange(code, contentStart, contentEnd);
        if (trimmedRange.start >= trimmedRange.end) continue;

        matches.push({
            index: match.index,
            fullLength: match[0].length,
            delimLen,
            contentStart,
            contentEnd,
            exprStart: trimmedRange.start,
            exprEnd: trimmedRange.end,
        });
    }

    return matches;
}

function buildLineOffsets(code: string): number[] {
    const offsets = [0];
    for (let i = 0; i < code.length; i++) {
        if (code[i] === "\n") offsets.push(i + 1);
    }
    return offsets;
}

function offsetToLineCol(offsets: number[], offset: number): { line: number; col: number } {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return { line: lo, col: offset - offsets[lo] };
}

function collectBladeFragments(
    code: string,
    lineOffsets: number[],
    echoMatches: BladeEchoMatch[],
    directiveMatches: BladeDirectiveMatch[],
): BladeFragment[] {
    const fragments: BladeFragment[] = [];

    for (const em of echoMatches) {
        const pos = offsetToLineCol(lineOffsets, em.exprStart);
        fragments.push({
            index: em.index,
            contentStart: em.exprStart,
            contentEnd: em.exprEnd,
            wrapperPrefix: "$__blade = ",
            wrapperSuffix: ";",
            originalContentStartLine: pos.line,
            originalContentStartCol: pos.col,
            syntheticStartLine: 0,
            syntheticEndLine: 0,
            syntheticContentStartCol: "$__blade = ".length,
        });
    }

    for (const dm of directiveMatches) {
        const contentStart = dm.openPos + 1;
        const pos = offsetToLineCol(lineOffsets, contentStart);
        const keyword = dm.directive === "if" || dm.directive === "elseif" ? "if" : dm.directive;
        const contentEnd = dm.directive === "foreach"
            ? getForeachIterableEnd(code, contentStart, dm.closePos)
            : dm.closePos;
        const wrapperPrefix = `${keyword}(`;
        fragments.push({
            index: dm.index,
            contentStart,
            contentEnd,
            wrapperPrefix,
            wrapperSuffix: ") {}",
            originalContentStartLine: pos.line,
            originalContentStartCol: pos.col,
            syntheticStartLine: 0,
            syntheticEndLine: 0,
            syntheticContentStartCol: wrapperPrefix.length,
        });
    }

    fragments.sort((a, b) => a.index - b.index);

    let syntheticLine = 1;
    for (const fragment of fragments) {
        const newlineCount = countNewlinesInRange(
            lineOffsets,
            fragment.contentStart,
            fragment.contentEnd,
        );
        fragment.syntheticStartLine = syntheticLine;
        fragment.syntheticEndLine = syntheticLine + newlineCount;
        syntheticLine += newlineCount + 1;
    }

    return fragments;
}

function extractBladeFragmentSites(code: string, fragments: BladeFragment[], sites: CallSite[]): void {
    if (fragments.length === 0) return;

    const syntheticParts = ["<?php\n"];
    for (const fragment of fragments) {
        syntheticParts.push(fragment.wrapperPrefix);
        syntheticParts.push(code.substring(fragment.contentStart, fragment.contentEnd));
        syntheticParts.push(fragment.wrapperSuffix);
        syntheticParts.push("\n");
    }

    try {
        const ast = parser.parseCode(syntheticParts.join(""), "blade-fragments.php");
        const fragmentSites: CallSite[] = [];
        visitAll(ast, fragmentSites, new Map());

        for (const site of fragmentSites) {
            const fragment = findFragmentForSite(site, fragments);
            if (!fragment) continue;
            remapSiteToOriginal(site, fragment);
            sites.push(site);
        }
    } catch {
        /* ignore */
    }
}

function findMatchingParen(code: string, openPos: number): number {
    let depth = 1;
    let inQuote: string | null = null;
    for (let i = openPos + 1; i < code.length; i++) {
        const char = code[i];
        const q = updateQuoteState(char, inQuote);
        inQuote = q.inQuote;
        if (q.skip) { i++; continue; }
        if (!inQuote) {
            if (char === "(") depth++;
            else if (char === ")" && --depth === 0) return i;
        }
    }
    return -1;
}

function collectBladeDirectiveMatches(code: string): BladeDirectiveMatch[] {
    BLADE_DIRECTIVE_REGEX.lastIndex = 0;
    const matches: BladeDirectiveMatch[] = [];
    let match;
    while ((match = BLADE_DIRECTIVE_REGEX.exec(code)) !== null) {
        const openPos = match.index + match[0].length - 1;
        const closePos = findMatchingParen(code, openPos);
        if (closePos !== -1) {
            matches.push({ index: match.index, directive: match[1], openPos, closePos });
        }
    }
    return matches;
}

function countNewlinesInRange(lineOffsets: number[], start: number, end: number): number {
    let count = 0;
    for (let i = 1; i < lineOffsets.length; i++) {
        if (lineOffsets[i] <= start) continue;
        if (lineOffsets[i] > end) break;
        count++;
    }
    return count;
}

function getForeachIterableEnd(
    code: string,
    contentStart: number,
    closePos: number,
): number {
    const content = code.substring(contentStart, closePos);
    const asMatch = content.match(/\s+as\s+/);
    return asMatch?.index !== undefined
        ? contentStart + asMatch.index
        : closePos;
}

function findFragmentForSite(site: CallSite, fragments: BladeFragment[]): BladeFragment | undefined {
    return fragments.find((fragment) =>
        site.namePosition.line >= fragment.syntheticStartLine &&
        site.namePosition.line <= fragment.syntheticEndLine,
    );
}

function remapSiteToOriginal(site: CallSite, fragment: BladeFragment): void {
    site.namePosition = remapPosition(site.namePosition, fragment);
    site.arguments = site.arguments.map((arg) => ({
        ...arg,
        ...remapPosition({ line: arg.line, character: arg.character }, fragment),
    }));
}

function remapPosition(
    position: { line: number; character: number },
    fragment: BladeFragment,
): { line: number; character: number } {
    const lineDelta = position.line - fragment.syntheticStartLine;
    if (lineDelta === 0) {
        return {
            line: fragment.originalContentStartLine,
            character:
                position.character - fragment.syntheticContentStartCol +
                fragment.originalContentStartCol,
        };
    }

    return {
        line: fragment.originalContentStartLine + lineDelta,
        character: position.character,
    };
}

function injectBladeEchos(original: string, cleaned: string, echoMatches: BladeEchoMatch[]): string {
    if (echoMatches.length === 0) return cleaned;

    const parts: string[] = [];
    let pos = 0;

    for (const em of echoMatches) {
        const start = em.index;
        const end = start + em.fullLength;

        // Copy cleaned content up to this echo
        if (start > pos) parts.push(cleaned.substring(pos, start));

        // Replace open delimiter with spaces
        parts.push(" ".repeat(em.delimLen));

        // Restore original content between delimiters
        parts.push(original.substring(start + em.delimLen, end - em.delimLen));

        // Replace close delimiter: first char becomes ";", rest spaces
        parts.push(";");
        if (em.delimLen > 1) parts.push(" ".repeat(em.delimLen - 1));

        pos = end;
    }

    // Append remaining cleaned content
    if (pos < cleaned.length) parts.push(cleaned.substring(pos));

    let result = parts.join("");

    result = result.replace(/\?>/g, "  ");
    result = result.replace(/<\?php/g, "     ");

    if (result.length >= 5) {
        result = "<?php" + result.substring(5);
    }

    return result;
}

function injectBladeDirectives(original: string, finalCleaned: string, directiveMatches: BladeDirectiveMatch[]): string {
    if (directiveMatches.length === 0) return finalCleaned;

    const parts: string[] = [];
    let pos = 0;

    for (const dm of directiveMatches) {
        if (dm.index > pos) parts.push(finalCleaned.substring(pos, dm.index));

        // Blank the "@directive(" prefix
        parts.push(" ".repeat(dm.openPos - dm.index + 1));

        // For @foreach, only inject the iterable expression (before " as ") so
        // that "as $var" doesn't produce invalid PHP in the temp file.
        const content = original.substring(dm.openPos + 1, dm.closePos);
        if (dm.directive === "foreach") {
            const asMatch = content.match(/\s+as\s+/);
            const cutAt = asMatch ? asMatch.index! : content.length;
            parts.push(content.substring(0, cutAt));
            parts.push(" ".repeat(content.length - cutAt));
        } else {
            parts.push(content);
        }

        // Replace closing ) with ; to form a valid PHP statement
        parts.push(";");

        pos = dm.closePos + 1;
    }

    if (pos < finalCleaned.length) parts.push(finalCleaned.substring(pos));

    return parts.join("");
}

function trimRange(code: string, start: number, end: number): { start: number; end: number } {
    while (start < end && /\s/.test(code[start])) {
        start++;
    }
    while (end > start && /\s/.test(code[end - 1])) {
        end--;
    }
    return { start, end };
}

function visitAll(node: any, sites: CallSite[], defs: Map<string, ResolvedParameter[]>): void {
    if (!node || typeof node !== "object") return;

    if (node.kind === "call" || node.kind === "new" || node.kind === "staticcall") {
        const site = extractCallSite(node);
        if (site) sites.push(site);
    }

    if (node.kind === "method" || node.kind === "function") {
        const name = node.name?.name ?? node.name;
        if (typeof name === "string" && node.arguments) {
            const params = extractDefParams(node.arguments);
            if (params.length > 0) {
                defs.set(name, params);
            }
        }
    }

    for (const key of Object.keys(node)) {
        if (key === "loc" || key === "position") continue;
        const child = node[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                if (item && typeof item === "object" && item.kind) {
                    visitAll(item, sites, defs);
                }
            }
        } else if (child && typeof child === "object" && child.kind) {
            visitAll(child, sites, defs);
        }
    }
}

function extractDefParams(params: any[]): ResolvedParameter[] {
    const result: ResolvedParameter[] = [];
    for (const param of params) {
        const name =
            typeof param.name === "string" ? param.name : param.name?.name;
        if (typeof name !== "string") continue;
        result.push({ name, isVariadic: !!param.variadic });
    }
    return result;
}

function extractCallSite(node: any): CallSite | null {
    const name = resolveName(node);
    if (!name) return null;

    const namePos = resolveNamePosition(node);
    if (!namePos) return null;

    const args = node.arguments;
    if (!args || args.length === 0) return null;

    const argInfos: ArgumentInfo[] = [];
    for (const arg of args) {
        const loc = arg.loc?.start;
        if (!loc) continue;

        const isNamed = arg.kind === "namedargument";
        const text = extractArgText(arg);

        argInfos.push({
            line: loc.line - 1,
            character: loc.column,
            isNamed,
            text,
        });
    }

    if (argInfos.length === 0) return null;

    return {
        name,
        namePosition: namePos,
        arguments: argInfos,
    };
}

function resolveName(node: any): string | null {
    if (node.kind === "new") {
        const what = node.what;
        if (!what) return null;
        return typeof what.name === "string" ? what.name : null;
    }

    if (node.kind === "staticcall") {
        const method = node.method;
        if (typeof method === "string") return method;
        if (method?.kind === "identifier" && method.name) return method.name;
        return null;
    }

    const what = node.what;
    if (!what) return null;

    if (what.kind === "propertylookup" || what.kind === "staticlookup") {
        const offset = what.offset;
        if (typeof offset === "string") return offset;
        if (offset?.kind === "identifier" && offset.name) return offset.name;
        return null;
    }

    return typeof what.name === "string" ? what.name : null;
}

function resolveNamePosition(node: any): { line: number; character: number } | null {
    let loc: any = null;

    if (node.kind === "new") {
        loc = node.what?.loc?.start;
    } else if (node.kind === "staticcall") {
        loc = node.method?.loc?.start ?? node.what?.loc?.start;
    } else if (node.kind === "call") {
        const what = node.what;
        if (what?.kind === "propertylookup" || what?.kind === "staticlookup") {
            loc = what.offset?.loc?.start ?? what.loc?.start;
        } else {
            loc = what?.loc?.start;
        }
    }

    if (!loc) return null;

    return {
        line: loc.line - 1,
        character: loc.column,
    };
}

function extractArgText(arg: any): string {
    switch (arg.kind) {
        case "namedargument":
            return arg.name ?? "";
        case "variable":
            return typeof arg.name === "string" ? arg.name : "";
        case "string":
            return `"${arg.value ?? ""}"`;
        case "number":
        case "nowdoc":
        case "encapsed":
            return String(arg.value ?? "");
        case "boolean":
            return arg.value ? "true" : "false";
        case "nullkeyword":
            return "null";
        case "array":
            return "[]";
        default:
            return "";
    }
}
