import * as vscode from "vscode";
import { ResolvedParameter } from "./types";
import { parseParamLabel, parseHoverSignature } from "./helpers";

export async function resolveParameters(
  uri: vscode.Uri,
  namePosition: { line: number; character: number },
  firstArgPosition: { line: number; character: number },
  argCount: number
): Promise<ResolvedParameter[]> {
  const namePos = new vscode.Position(namePosition.line, namePosition.character);
  const argPos = new vscode.Position(firstArgPosition.line, firstArgPosition.character);

  // Primary: SignatureHelp (triggered at first arg position, inside the parens)
  const params = await trySignatureHelp(uri, argPos, argCount);
  if (params.length > 0) return params;

  // Fallback: Hover on the function/method name
  return tryHover(uri, namePos, argCount);
}

async function trySignatureHelp(
  uri: vscode.Uri,
  position: vscode.Position,
  argCount: number
): Promise<ResolvedParameter[]> {
  try {
    const help = await vscode.commands.executeCommand<vscode.SignatureHelp>(
      "vscode.executeSignatureHelpProvider",
      uri,
      position
    );

    if (!help?.signatures?.length) return [];

    const sig = help.signatures[help.activeSignature ?? 0] ?? help.signatures[0];
    if (!sig.parameters?.length) return [];

    return parseSignatureParameters(sig.parameters, argCount);
  } catch {
    return [];
  }
}

function parseSignatureParameters(
  parameters: readonly vscode.ParameterInformation[],
  argCount: number
): ResolvedParameter[] {
  const result: ResolvedParameter[] = [];

  for (let i = 0; i < parameters.length; i++) {
    const param = parameters[i];
    const label =
      typeof param.label === "string"
        ? param.label
        : "";

    const parsed = parseParamLabel(label);
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

async function tryHover(
  uri: vscode.Uri,
  position: vscode.Position,
  argCount: number
): Promise<ResolvedParameter[]> {
  try {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      uri,
      position
    );

    if (!hovers?.length) return [];

    for (const hover of hovers) {
      for (const content of hover.contents) {
        const text =
          content instanceof vscode.MarkdownString
            ? content.value
            : typeof content === "string"
              ? content
              : "";

        const params = parseHoverSignature(text, argCount);
        if (params.length > 0) return params;
      }
    }

    return [];
  } catch {
    return [];
  }
}
