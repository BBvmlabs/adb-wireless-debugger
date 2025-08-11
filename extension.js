const vscode = require('vscode');
const { exec } = require('child_process');
const os = require('os');

function getNetworkInterfaces() {
    const nets = os.networkInterfaces();
    let results = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                results.push({ name, address: net.address });
            }
        }
    }
    return results;
}

function execCommand(command, input) {
    return new Promise((resolve, reject) => {
        const child = exec(command, (error, stdout, stderr) => {
            if (error) reject(stderr || error.message);
            else resolve(stdout);
        });
        if (input) {
            child.stdin.write(input + '\n');
            child.stdin.end();
        }
    });
}

async function adbPair(ipPort, pairCode) {
    return execCommand(`adb pair ${ipPort}`, pairCode);
}

async function adbConnect(ipPort) {
    return execCommand(`adb connect ${ipPort}`);
}

function getIpPrefix(ip) {
    // get first 3 octets, e.g. 192.168.1.
    const parts = ip.split('.');
    if (parts.length === 4) {
        return parts.slice(0, 3).join('.') + '.';
    }
    return ip;
}

async function promptForLastDigitsAndPort(ipPrefix) {
    // last 3 digits of device IP
    const lastDigits = await vscode.window.showInputBox({
        prompt: `Enter the last part of device IP address (after ${ipPrefix})`,
        validateInput: val => {
            if (!val.match(/^\d{1,3}$/)) return 'Enter 1 to 3 digits';
            const n = Number(val);
            if (n < 0 || n > 255) return 'Must be between 0 and 255';
            return null;
        }
    });
    if (!lastDigits) return null;

    // port number
    const port = await vscode.window.showInputBox({
        prompt: 'Enter port number',
        value: '5555',
        validateInput: val => {
            const p = Number(val);
            if (isNaN(p) || p <= 0 || p > 65535) return 'Enter valid port number';
            return null;
        }
    });
    if (!port) return null;

    return `${ipPrefix}${lastDigits}:${port}`;
}

async function activate(context) {
    const disposablePair = vscode.commands.registerCommand('wirelessDebug.pair', async () => {
        try {
            const nets = getNetworkInterfaces();
            if (nets.length === 0) {
                vscode.window.showErrorMessage('No active network interfaces found.');
                return;
            }
            const pick = await vscode.window.showQuickPick(
                nets.map(n => ({ label: `${n.name} - ${n.address}`, ip: n.address })),
                { placeHolder: 'Select your network IP to pair' }
            );
            if (!pick) return;

            const ipPrefix = getIpPrefix(pick.ip);

            const ipPortInput = await promptForLastDigitsAndPort(ipPrefix);
            if (!ipPortInput) return;

            const pairCode = await vscode.window.showInputBox({
                prompt: 'Enter the 6-digit wireless debugging pair code',
                placeHolder: 'e.g. 123456',
                validateInput: val => {
                    if (!val.match(/^\d{6}$/)) return 'Pair code must be exactly 6 digits';
                    return null;
                }
            });
            if (!pairCode) return;

            vscode.window.showInformationMessage(`Pairing with ${ipPortInput} ...`);
            const pairOutput = await adbPair(ipPortInput, pairCode);
            vscode.window.showInformationMessage('Pair Output: ' + pairOutput.trim());

            const connectNow = await vscode.window.showQuickPick(['Yes', 'No'], {
                placeHolder: 'Connect to device now?'
            });
            if (connectNow === 'Yes') {
                const connectIpPort = await promptForLastDigitsAndPort(ipPrefix);
                if (!connectIpPort) return;

                const connectOutput = await adbConnect(connectIpPort);
                vscode.window.showInformationMessage('Connect Output: ' + connectOutput.trim());
            }
        } catch (e) {
            vscode.window.showErrorMessage('Error: ' + e);
        }
    });

    const disposableConnect = vscode.commands.registerCommand('wirelessDebug.connect', async () => {
        try {
            const nets = getNetworkInterfaces();
            if (nets.length === 0) {
                vscode.window.showErrorMessage('No active network interfaces found.');
                return;
            }
            const netPick = await vscode.window.showQuickPick(
                nets.map(n => ({ label: `${n.name} - ${n.address}`, ip: n.address })),
                { placeHolder: 'Select your network IP' }
            );
            if (!netPick) return;

            const ipPrefix = getIpPrefix(netPick.ip);
            const deviceIpPort = await promptForLastDigitsAndPort(ipPrefix);
            if (!deviceIpPort) return;

            vscode.window.showInformationMessage(`Connecting to ${deviceIpPort} ...`);
            const connectOutput = await adbConnect(deviceIpPort);
            vscode.window.showInformationMessage('Connect Output: ' + connectOutput.trim());
        } catch (e) {
            vscode.window.showErrorMessage('Error: ' + e);
        }
    });

    context.subscriptions.push(disposablePair, disposableConnect);
}

function deactivate() {}

module.exports = { activate, deactivate };
