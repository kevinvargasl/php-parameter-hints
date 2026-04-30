import * as vscode from "vscode";
import { ResolvedParameter } from "./types";
import { parseParamLabel, parseHoverSignature } from "./helpers";

export async function resolveParameters(
    uri: vscode.Uri,
    namePosition: { line: number; character: number },
    firstArgPosition: { line: number; character: number },
    argCount: number,
): Promise<ResolvedParameter[]> {
    const params = await resolveParametersFromSignatureHelp(
        uri,
        firstArgPosition,
        argCount,
    );
    if (params.length > 0) return params;

    return resolveParametersFromHover(uri, namePosition, argCount);
}

export async function resolveParametersFromSignatureHelp(
    uri: vscode.Uri,
    firstArgPosition: { line: number; character: number },
    argCount: number,
): Promise<ResolvedParameter[]> {
    const argPos = new vscode.Position(
        firstArgPosition.line,
        firstArgPosition.character,
    );
    return trySignatureHelp(uri, argPos, argCount);
}

export async function resolveParametersFromHover(
    uri: vscode.Uri,
    namePosition: { line: number; character: number },
    argCount: number,
): Promise<ResolvedParameter[]> {
    const namePos = new vscode.Position(
        namePosition.line,
        namePosition.character,
    );
    return tryHover(uri, namePos, argCount);
}

async function trySignatureHelp(uri: vscode.Uri, position: vscode.Position, argCount: number): Promise<ResolvedParameter[]> {
    try {
        const help = await vscode.commands.executeCommand<vscode.SignatureHelp>(
            "vscode.executeSignatureHelpProvider",
            uri,
            position,
        );

        if (!help?.signatures?.length) return [];

        const signature = help.signatures[help.activeSignature ?? 0] ?? help.signatures[0];
        if (!signature.parameters?.length) return [];

        return parseSignatureParameters(signature.parameters, argCount);
    } catch {
        return [];
    }
}

function parseSignatureParameters(parameters: readonly vscode.ParameterInformation[], argCount: number): ResolvedParameter[] {
    const result: ResolvedParameter[] = [];

    for (let i = 0; i < parameters.length; i++) {
        const param = parameters[i];
        const label = typeof param.label === "string" ? param.label : "";

        const parsed = parseParamLabel(label);
        if (!parsed) continue;

        if (parsed.isVariadic) {
            const remaining = Math.min(argCount - i, 256);
            for (let j = 0; j < remaining; j++) {
                result.push({ name: `${parsed.name}[${j}]`, isVariadic: true });
            }
            break;
        }

        result.push(parsed);
    }

    return result;
}

async function tryHover(uri: vscode.Uri, position: vscode.Position, argCount: number): Promise<ResolvedParameter[]> {
    try {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider",
            uri,
            position,
        );

        if (!hovers?.length) return [];

        for (const hover of hovers) {
            for (const content of hover.contents) {
                const text = toHoverText(content);
                if (!text || !couldContainCallableSignature(text)) {
                    continue;
                }

                const params = parseHoverSignature(text, argCount);
                if (params.length > 0) return params;
            }
        }
    } catch {
    }

    return [];
}

function toHoverText(content: vscode.MarkdownString | vscode.MarkedString): string {
    if (content instanceof vscode.MarkdownString) {
        return content.value;
    }

    return typeof content === "string" ? content : "";
}

function couldContainCallableSignature(text: string): boolean {
    if (text.length === 0 || text.length > 50_000) return false;
    return text.includes("(") && text.includes(")");
}
