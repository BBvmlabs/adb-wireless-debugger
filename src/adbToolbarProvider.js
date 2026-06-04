const vscode = require('vscode');

class AdbToolbarProvider {
    constructor(context, isDev) {
        this.context = context;
        this.isDev = isDev;
        this._view = null;
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtml();

        webviewView.webview.onDidReceiveMessage(msg => {
            const cmd = msg.command;
            if (cmd) vscode.commands.executeCommand(cmd);
        });
    }

    _getHtml() {
        const isDev = this.isDev;
        const devBadge = isDev
            ? `<span class="dev-badge">DEV</span>`
            : '';

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
        font-family: 'Segoe UI', system-ui, sans-serif;
        background: transparent;
        color: var(--vscode-foreground);
        padding: 10px 12px 12px;
        overflow: hidden;
    }

    .header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    }

    .ext-name {
        font-size: 0.95em;
        font-weight: 700;
        color: var(--vscode-foreground);
        letter-spacing: 0.3px;
    }

    .dev-badge {
        font-size: 0.6em;
        font-weight: 700;
        background: rgba(252, 129, 74, 0.2);
        color: #fc814a;
        border: 1px solid rgba(252, 129, 74, 0.35);
        padding: 2px 6px;
        border-radius: 100px;
        letter-spacing: 1px;
        vertical-align: middle;
    }

    .btn-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
    }

    .btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.05));
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
        border-radius: 6px;
        padding: 7px 10px;
        cursor: pointer;
        font-size: 0.82em;
        font-weight: 500;
        transition: all 0.15s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .btn:hover {
        background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1));
        border-color: var(--vscode-focusBorder, rgba(99,179,237,0.4));
        color: var(--vscode-foreground);
        transform: translateY(-1px);
        box-shadow: 0 3px 8px rgba(0,0,0,0.3);
    }

    .btn:active {
        transform: translateY(0px);
        box-shadow: none;
    }

    .btn.primary {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
        border-color: transparent;
        grid-column: span 2;
    }

    .btn.primary:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
        border-color: transparent;
    }

    .btn .icon {
        font-size: 1em;
        flex-shrink: 0;
    }

    .separator {
        height: 1px;
        background: var(--vscode-widget-border, rgba(255,255,255,0.06));
        margin: 8px 0;
    }

    .section-label {
        font-size: 0.7em;
        font-weight: 600;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground, #888);
        margin-bottom: 6px;
    }
</style>
</head>
<body>

<div class="header">
    <span class="ext-name">ADB Wireless${isDev ? ' ' : ''}</span>
    ${devBadge}
</div>

<p class="section-label">Connection</p>
<div class="btn-grid">
    <button class="btn primary" onclick="cmd('wirelessDebug.autoConnect')">
        <span class="icon">📡</span> Auto-Discover &amp; Connect
    </button>
    <button class="btn" onclick="cmd('wirelessDebug.pairQr')">
        <span class="icon">📷</span> Pair via QR
    </button>
    <button class="btn" onclick="cmd('wirelessDebug.pair')">
        <span class="icon">🔑</span> Pair via Code
    </button>
    <button class="btn" onclick="cmd('wirelessDebug.connect')">
        <span class="icon">🔗</span> Connect IP
    </button>
</div>

<div class="separator"></div>
<p class="section-label">Tools</p>
<div class="btn-grid">
    <button class="btn" onclick="cmd('wirelessDebug.refreshDevices')">
        <span class="icon">🔄</span> Refresh
    </button>
    <button class="btn" onclick="cmd('wirelessDebug.clearHistory')" style="border-color: rgba(252,79,79,0.25);">
        <span class="icon">🗑️</span> Clear History
    </button>
</div>

<script>
    const vscode = acquireVsCodeApi();
    function cmd(command) {
        vscode.postMessage({ command });
    }
</script>
</body>
</html>`;
    }
}

module.exports = { AdbToolbarProvider };
