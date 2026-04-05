import { ResolvedParameter } from "./types";

const STARTS_WITH_DIGIT = /^\d/;
const SEPARATORS = /[_-]/g;
const FUNCTION_SIGNATURE = /function\s+\w+\s*\(/;
const CALLABLE_SIGNATURE = /\w+\s*\(/;

export function isLiteral(text: string): boolean {
    if (!text) return false;
    if (
        text.startsWith('"') || text.startsWith("'") ||
        text === "true" || text === "false" ||
        text === "null" || text === "[]" ||
        STARTS_WITH_DIGIT.test(text)
    ) {
        return true;
    }
    return false;
}

export function namesMatch(argText: string, paramName: string): boolean {
    if (!argText || !paramName) return false;
    const normalizedArg = argText.toLowerCase().replace(SEPARATORS, "");
    const normalizedParam = paramName.toLowerCase().replace(SEPARATORS, "");
    return normalizedArg === normalizedParam;
}

export function formatLabel(param: { name: string }): string {
    return param.name;
}

export function parseParamLabel(label: string): ResolvedParameter | null {
    const match = label.match(
        /(?:(\??\w[\w\\|&]*(?:\[\])?)\s+)?(\.\.\.)?(\$\w+)/,
    );
    if (!match) return null;

    const isVariadic = !!match[2];
    const name = match[3].substring(1);

    return { name, isVariadic };
}

export function parseHoverSignature(markdown: string, argCount: number): ResolvedParameter[] {
    const paramStr = extractParamString(markdown);
    if (!paramStr) return [];
    return parseParamList(paramStr, argCount);
}

export function updateQuoteState(char: string, inQuote: string | null): { inQuote: string | null; skip: boolean } {
    if (char === "\\" && inQuote) {
        return { inQuote, skip: true };
    }
    if ((char === "'" || char === '"') && !inQuote) {
        return { inQuote: char, skip: false };
    }
    if (char === inQuote) {
        return { inQuote: null, skip: false };
    }

    return { inQuote, skip: false };
}

function extractParamString(markdown: string): string | null {
    if (markdown.length > 50_000) return null;

    let idx = markdown.search(FUNCTION_SIGNATURE);
    if (idx === -1) {
        idx = markdown.search(CALLABLE_SIGNATURE);
        if (idx === -1) return null;
    }

    const openParenthesis = markdown.indexOf("(", idx);
    if (openParenthesis === -1) return null;

    let inQuote: string | null = null;
    let depth = 0;
    for (let i = openParenthesis; i < markdown.length; i++) {
        const char = markdown[i];
        const q = updateQuoteState(char, inQuote);
        inQuote = q.inQuote;
        if (q.skip) {
            i++;
            continue;
        }

        if (!inQuote) {
            if (char === "(") {
                depth++;
            } else if (char === ")") {
                depth--;
                if (depth === 0) {
                    return markdown.substring(openParenthesis + 1, i);
                }
            }
        }
    }

    return null;
}

export function parseParamList(paramStr: string, argCount: number): ResolvedParameter[] {
    if (!paramStr.trim()) return [];

    const parts = splitParams(paramStr);
    const result: ResolvedParameter[] = [];

    for (let i = 0; i < parts.length; i++) {
        const parsed = parseParamLabel(parts[i].trim());
        if (!parsed) continue;

        if (parsed.isVariadic) {
            const remaining = Math.min(argCount - i, 256);
            for (let j = 0; j < remaining; j++) {
                result.push({
                    name: `${parsed.name}[${j}]`,
                    isVariadic: true,
                });
            }
            break;
        }
        result.push(parsed);
    }
    return result;
}

export function splitParams(paramStr: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    let inQuote: string | null = null;

    for (let i = 0; i < paramStr.length; i++) {
        const char = paramStr[i];
        const q = updateQuoteState(char, inQuote);
        inQuote = q.inQuote;
        if (q.skip) {
            current += char + (paramStr[i + 1] ?? "");
            i++;
            continue;
        }

        if (!inQuote) {
            if (char === "(" || char === "[" || char === "<") {
                depth++;
            } else if ((char === ")" || char === "]" || char === ">") && depth > 0) {
                depth--;
            }

            if (char === "," && depth === 0) {
                parts.push(current);
                current = "";
                continue;
            }
        }

        current += char;
    }

    if (current.trim()) parts.push(current);
    return parts;
}
