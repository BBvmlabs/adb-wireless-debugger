const vscode = require('vscode');
const dns = require('dns');
const { AdbDeviceProvider } = require('./src/adbProvider');
const { AdbToolbarProvider } = require('./src/adbToolbarProvider');

// Fix for slow IPv6 resolution on some systems
if (dns.setDefaultAutoSelectFamilyAttemptTimeout) {
    dns.setDefaultAutoSelectFamilyAttemptTimeout(1000);
}
const {
    mirrorDevice, disconnectDevice, pairDevice, connectDevice,
    openLogcat, stopLogcat, takeScreenshot, switchToWireless, rebootDevice, wirelessPairingQr,
    startLiveView, autoDiscoverConnect, refreshDevicesCommand
} = require('./src/adbCommands');

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    const provider = new AdbDeviceProvider(context);

    // Check extension flavor from package name (starts with 'dev-')
    const isDev = context.extension.packageJSON.name.startsWith('dev-');
    const viewTitle = isDev ? 'Dev-Devices' : 'Devices';

    // Register the TreeView
    const treeView = vscode.window.createTreeView('dev-adbDevices', {
        treeDataProvider: provider,
        showCollapseAll: true
    });
    treeView.title = viewTitle;

    // Register the toolbar WebviewView
    const toolbarProvider = new AdbToolbarProvider(context, isDev);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('dev-adbToolbar', toolbarProvider)
    );

    const commands = [
        vscode.commands.registerCommand('dev.wirelessDebug.refreshDevices', () => refreshDevicesCommand(provider)),
        vscode.commands.registerCommand('dev.wirelessDebug.autoConnect', () => autoDiscoverConnect(provider)),
        vscode.commands.registerCommand('dev.wirelessDebug.clearHistory', () => provider.clearHistory()),
        vscode.commands.registerCommand('dev.wirelessDebug.pair', () => pairDevice(provider)),
        vscode.commands.registerCommand('dev.wirelessDebug.pairQr', () => wirelessPairingQr(provider)),
        vscode.commands.registerCommand('dev.wirelessDebug.connect', (d) => connectDevice(provider, d)),
        vscode.commands.registerCommand('dev.wirelessDebug.disconnect', (d) => d && disconnectDevice(d, provider)),
        vscode.commands.registerCommand('dev.wirelessDebug.mirror', async (d) => await mirrorDevice(d || await selectDevice(provider))),
        vscode.commands.registerCommand('dev.wirelessDebug.liveView', async (d) => await startLiveView(d || await selectDevice(provider))),
        vscode.commands.registerCommand('dev.wirelessDebug.logcat', (d) => d && openLogcat(d)),
        vscode.commands.registerCommand('dev.wirelessDebug.stopLogcat', (d) => d && stopLogcat(d)),
        vscode.commands.registerCommand('dev.wirelessDebug.screenshot', (d) => d && takeScreenshot(d)),
        vscode.commands.registerCommand('dev.wirelessDebug.switchToWireless', (d) => d && switchToWireless(d, provider)),
        vscode.commands.registerCommand('dev.wirelessDebug.reboot', (d) => d && rebootDevice(d, provider)),
        vscode.commands.registerCommand('dev.wirelessDebug.deleteHistoryItem', (d) => d && provider.deleteHistoryItem(d)),
    ];

    context.subscriptions.push(provider, treeView, ...commands);
}

async function selectDevice(provider) {
    const devices = provider.devices;
    if (devices.length === 0) {
        vscode.window.showErrorMessage('No devices connected.');
        return null;
    }
    const pick = await vscode.window.showQuickPick(
        devices.map(d => ({ label: `${d.model || d.id} (${d.state})`, device: d })),
        { placeHolder: 'Select a device' }
    );
    return pick ? pick.device : null;
}

function deactivate() { }

module.exports = { activate, deactivate };
