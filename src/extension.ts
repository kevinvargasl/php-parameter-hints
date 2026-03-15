import * as vscode from "vscode";
import { PhpInlayHintsProvider } from "./inlayHintsProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PhpInlayHintsProvider();

  const phpLanguages = ["php", "blade"];

  const selector: vscode.DocumentSelector = phpLanguages.flatMap((language) => [
    { language, scheme: "file" },
    { language, scheme: "untitled" },
  ]);

  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider(selector, provider)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("phpParameterHints")) {
        provider.fireRefresh();
      }
    })
  );

  const pendingInvalidations = new Map<string, NodeJS.Timeout>();
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!phpLanguages.includes(e.document.languageId)) return;

      const uriStr = e.document.uri.toString();
      const existing = pendingInvalidations.get(uriStr);
      if (existing) clearTimeout(existing);

      pendingInvalidations.set(
        uriStr,
        setTimeout(() => {
          pendingInvalidations.delete(uriStr);
          provider.invalidateDocument(e.document.uri);
        }, 250)
      );
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (!phpLanguages.includes(doc.languageId)) return;
      provider.invalidateDocument(doc.uri);
    })
  );

  context.subscriptions.push({
    dispose: () => {
      for (const timeout of pendingInvalidations.values()) {
        clearTimeout(timeout);
      }
      pendingInvalidations.clear();
    },
  });

  context.subscriptions.push(provider);
}

export function deactivate(): void {}
