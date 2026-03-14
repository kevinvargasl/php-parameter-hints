import { ResolvedParameter } from "./types";

export function isLiteral(text: string): boolean {
  if (!text) return false;
  if (
    text.startsWith('"') ||
    text.startsWith("'") ||
    text === "true" ||
    text === "false" ||
    text === "null" ||
    text === "[]" ||
    /^\d/.test(text)
  ) {
    return true;
  }
  return false;
}

export function namesMatch(argText: string, paramName: string): boolean {
  if (!argText || !paramName) return false;
  const normalizedArg = argText.toLowerCase().replace(/[_-]/g, "");
  const normalizedParam = paramName.toLowerCase().replace(/[_-]/g, "");
  return normalizedArg === normalizedParam;
}

export function formatLabel(param: { name: string }): string {
  return param.name;
}

export function parseParamLabel(label: string): ResolvedParameter | null {
  const match = label.match(
    /(?:(\??\w[\w\\|&]*(?:\[\])?)\s+)?(\.\.\.)?(\$\w+)/
  );
  if (!match) return null;

  const isVariadic = !!match[2];
  const name = match[3].substring(1); // strip $

  return { name, isVariadic };
}

export function parseHoverSignature(
  markdown: string,
  argCount: number
): ResolvedParameter[] {
  const paramStr = extractParamString(markdown);
  if (!paramStr) return [];
  return parseParamList(paramStr, argCount);
}

function extractParamString(markdown: string): string | null {
  // Try function signature first
  let idx = markdown.search(/function\s+\w+\s*\(/);
  if (idx === -1) {
    // Fallback: method/function pattern inside code fence
    idx = markdown.search(/\w+\s*\(/);
    if (idx === -1) return null;
  }

  // Find the opening paren
  const openParen = markdown.indexOf("(", idx);
  if (openParen === -1) return null;

  // Use depth counting to find the matching close paren
  let depth = 0;
  for (let i = openParen; i < markdown.length; i++) {
    if (markdown[i] === "(") depth++;
    else if (markdown[i] === ")") {
      depth--;
      if (depth === 0) {
        return markdown.substring(openParen + 1, i);
      }
    }
  }

  return null;
}

export function parseParamList(
  paramStr: string,
  argCount: number
): ResolvedParameter[] {
  if (!paramStr.trim()) return [];

  const parts = splitParams(paramStr);
  const result: ResolvedParameter[] = [];

  for (let i = 0; i < parts.length; i++) {
    const parsed = parseParamLabel(parts[i].trim());
    if (!parsed) continue;

    if (parsed.isVariadic) {
      const remaining = argCount - i;
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

  for (const char of paramStr) {
    if (char === "(" || char === "[" || char === "<") depth++;
    else if ((char === ")" || char === "]" || char === ">") && depth > 0) depth--;

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) parts.push(current);
  return parts;
}
