<h3 align="center">
<img src="https://raw.githubusercontent.com/kevinvargasl/php-parameter-hints/main/assets/logo.png" width="100" alt="Logo"/><br/>
PHP Parameter Hints
</h3>

Inline parameter name hints for PHP function and method calls in VS Code. Works with both `.php` and `.blade.php` files.

After indexing open and start editing a file to see the inline hints.

![PHP Parameter Hints](https://raw.githubusercontent.com/kevinvargasl/php-parameter-hints/main/assets/dark-theme-example.png)

## Features

- Parameter name hints for function calls, method calls, constructors, and static methods
- Blade template support: `<?php ?>` blocks, `@php`/`@endphp` directives, `{{ }}`/`{!! !!}` echo expressions, and control directives (`@if`, `@elseif`, `@foreach`, `@for`, `@while`)
- Handles PHP 8 named arguments (hints are hidden for named args)
- Variadic parameter expansion (`...$items` shows as `items[0]:`, `items[1]:`, etc.)
- Caching for fast performance on large files

## Installation

### Marketplace

Visit [the extension page](https://marketplace.visualstudio.com/items?itemName=kevinvargasl.php-parameter-hints) and press **install**.

### From .vsix

- Download the .vsix file from the las [release](https://github.com/kevinvargasl/php-parameter-hints/releases)
- Open VS Code
- Press Ctrl+Shift+P and run **Extensions: Install from VSIX...**
- Select the .vsix file

## Settings

All settings are under `phpParameterHints.*` in VS Code settings.

| Setting | Type | Default | Description |
|---|---|---|---|
| `phpParameterHints.enabled` | `boolean` | `true` | Enable or disable parameter hints |
| `phpParameterHints.literalsOnly` | `boolean` | `false` | Only show hints for literal values (strings, numbers, booleans, null, arrays) |
| `phpParameterHints.collapseWhenEqual` | `boolean` | `true` | Hide the hint when the variable name matches the parameter name |

### Colors
You can edit the background and font colors to match your style, add to the settings.json:
```js
"workbench.colorCustomizations": {
   "editorInlayHint.parameterBackground": "#fff",
   "editorInlayHint.parameterForeground": "#000"
}
```

## Screenshots

<details>
<summary>PHP files</summary>
<img src="https://raw.githubusercontent.com/kevinvargasl/php-parameter-hints/main/assets/php-example.png"/>
</details>
<details>
<summary>Blade files</summary>
<img src="https://raw.githubusercontent.com/kevinvargasl/php-parameter-hints/main/assets/blade-example.png"/>
</details>

## Requirements

- VS Code 1.75.0 or later
- A PHP language server extension (recommended: [Intelephense](https://marketplace.visualstudio.com/items?itemName=bmewburn.vscode-intelephense-client)) for best results with built-in functions and third-party libraries

The extension works without a language server, but hints will only appear for functions and methods defined in the same file.
