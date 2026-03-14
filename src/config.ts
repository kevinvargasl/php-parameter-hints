import * as vscode from "vscode";

export interface PhpParameterHintsConfig {
  enabled: boolean;
  literalsOnly: boolean;
  collapseWhenEqual: boolean;
}

export function getConfig(): PhpParameterHintsConfig {
  const cfg = vscode.workspace.getConfiguration("phpParameterHints");
  return {
    enabled: cfg.get<boolean>("enabled", true),
    literalsOnly: cfg.get<boolean>("literalsOnly", false),
    collapseWhenEqual: cfg.get<boolean>("collapseWhenEqual", true),
  };
}
