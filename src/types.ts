export interface CallSite {
  name: string;
  namePosition: { line: number; character: number };
  arguments: ArgumentInfo[];
}

export interface ArgumentInfo {
  line: number;
  character: number;
  isNamed: boolean;
  text: string;
}

export interface ResolvedParameter {
  name: string;
  isVariadic: boolean;
}

export interface PhpParameterHintsConfig {
  enabled: boolean;
  literalsOnly: boolean;
  collapseWhenEqual: boolean;
}
