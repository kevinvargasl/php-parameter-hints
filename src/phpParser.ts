// eslint-disable-next-line @typescript-eslint/no-require-imports
const phpParser = require("php-parser");
import { CallSite, ArgumentInfo, ResolvedParameter } from "./types";

const BLADE_ECHO_REGEX = /\{\{(?!--)([\s\S]{0,2000}?)\}\}|\{!!([\s\S]{0,2000}?)!!\}/g;
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
  return code.includes("@php") || code.includes("{{") || code.includes("{!!");
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
      const echoMatches = collectBladeEchoMatches(converted);
      extractBladeEchoSites(converted, echoMatches, sites);
      finalCleaned = injectBladeEchos(converted, cleaned, echoMatches);
    } else {
      finalCleaned = cleaned;
    }

    return { callSites: sites, definitions: defs, cleanedCode: finalCleaned };
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
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "@php") {
      lines[i] = "<?php";
    } else if (trimmed === "@endphp") {
      lines[i] = "?>";
    }
  }
  return lines.join("\n");
}

function blankOut(code: string, from: number, to: number): string {
  return code.substring(from, to).replace(NON_NEWLINE, " ");
}

interface BladeEchoMatch {
  index: number;
  fullLength: number;
  openLen: number;
  closeLen: number;
  contentStart: number;
  contentEnd: number;
}

function collectBladeEchoMatches(code: string): BladeEchoMatch[] {
  BLADE_ECHO_REGEX.lastIndex = 0;
  const matches: BladeEchoMatch[] = [];
  let match;

  while ((match = BLADE_ECHO_REGEX.exec(code)) !== null) {
    const content = match[1] ?? match[2];
    if (!content || !content.trim()) continue;

    const isRaw = match[0].startsWith("{!!");
    const openLen = isRaw ? 3 : 2;
    const closeLen = isRaw ? 3 : 2;

    matches.push({
      index: match.index,
      fullLength: match[0].length,
      openLen,
      closeLen,
      contentStart: match.index + openLen,
      contentEnd: match.index + match[0].length - closeLen,
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
  let lo = 0, hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, col: offset - offsets[lo] };
}

function extractBladeEchoSites(code: string, echoMatches: BladeEchoMatch[], sites: CallSite[]): void {
  if (echoMatches.length === 0) return;

  const lineOffsets = buildLineOffsets(code);

  for (const em of echoMatches) {
    const raw = code.substring(em.contentStart, em.contentEnd);
    const expr = raw.trim();
    const exprStart = em.contentStart + (raw.length - raw.trimStart().length);
    const pos = offsetToLineCol(lineOffsets, exprStart);

    try {
      const ast = parser.parseCode(`<?php ${expr};`, "echo.php");
      const echoSites: CallSite[] = [];
      visitAll(ast, echoSites, new Map());

      for (const site of echoSites) {
        site.namePosition.line += pos.line;
        site.namePosition.character += pos.col - 6;
        for (const arg of site.arguments) {
          arg.line += pos.line;
          arg.character += pos.col - 6;
        }
        sites.push(site);
      }
    } catch { /* ignore */ }
  }
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
    parts.push(" ".repeat(em.openLen));

    // Restore original content between delimiters
    parts.push(original.substring(start + em.openLen, end - em.closeLen));

    // Replace close delimiter: first char becomes ";", rest spaces
    parts.push(";");
    if (em.closeLen > 1) parts.push(" ".repeat(em.closeLen - 1));

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

function visitAll(
  node: any,
  sites: CallSite[],
  defs: Map<string, ResolvedParameter[]>
): void {
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
    const name = typeof param.name === "string"
      ? param.name
      : param.name?.name;
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
    if (typeof what.name === "string") return what.name;
    if (what.kind === "name" && what.name) return what.name;
    if (what.resolution === "fqn" && what.name) return what.name;
    return null;
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

  if (typeof what.name === "string") return what.name;
  if (what.kind === "name" && what.name) return what.name;

  return null;
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
  if (arg.kind === "namedargument") {
    return arg.name ?? "";
  }

  if (arg.kind === "variable") {
    return typeof arg.name === "string" ? arg.name : "";
  }

  if (arg.kind === "string") return `"${arg.value ?? ""}"`;
  if (arg.kind === "number" || arg.kind === "nowdoc" || arg.kind === "encapsed") {
    return String(arg.value ?? "");
  }
  if (arg.kind === "boolean") return arg.value ? "true" : "false";
  if (arg.kind === "nullkeyword") return "null";
  if (arg.kind === "array") return "[]";

  return "";
}

