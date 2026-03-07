const vscode = require('vscode');
const { exec } = require('child_process');
const { getDeviceIp, execCommand, getAllNetworks, discoverAdbServices } = require('./utils');

async function mirrorDevice(device) {
    const config = vscode.workspace.getConfiguration('wirelessDebug');
    const scrcpyPath = config.get('scrcpyPath') || 'scrcpy';
    const deviceId = device.id;

    vscode.window.showInformationMessage(`Starting Screen Mirror for ${deviceId}...`);

    const command = `${scrcpyPath} -s ${deviceId} --window-title "Mirror: ${device.model || deviceId}"`;
    exec(command, (error, stdout, stderr) => {
        if (error) {
            vscode.window.showErrorMessage(`Screen Mirror Error: ${stderr || error.message}`);
        }
    });
}

async function disconnectDevice(device, provider) {
    const deviceId = device.id;
    try {
        if (deviceId.includes(':')) {
            await execCommand(`adb disconnect ${deviceId}`);
            vscode.window.showInformationMessage(`Disconnected from ${deviceId}`);
        } else {
            vscode.window.showWarningMessage('USB devices cannot be manually disconnected via ADB.');
        }
        provider.refresh();
    } catch (e) {
        vscode.window.showErrorMessage(`Error: ${e}`);
    }
}

async function pairDevice(provider, discoveryItem) {
    let ipPort = discoveryItem ? discoveryItem.ipPort : null;

    if (!ipPort) {
        // Fallback to guided flow if not clicked from discovery
        const networks = getAllNetworks();
        const networkPicks = networks.map(n => ({
            label: `$(radio-tower) ${n.name}`,
            description: `Connect via: ${n.address}`,
            network: n
        }));

        const selectedNetwork = await vscode.window.showQuickPick(networkPicks, {
            placeHolder: 'Select the Network your device is on (Wi-Fi, Hotspot, etc.)'
        });
        if (!selectedNetwork) return;

        // Discovery with retry (Like Android Studio)
        let found = [];
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Searching for devices ready to pair...",
        }, async (progress) => {
            found = await discoverAdbServices('pairing');
            if (found.length === 0) {
                progress.report({ message: "No devices found initially, retrying..." });
                await new Promise(r => setTimeout(r, 2500)); // Wait for mDNS
                found = await discoverAdbServices('pairing');
            }
        });

        if (found.length === 1) {
            ipPort = found[0].ipPort;
            vscode.window.showInformationMessage(`Found: ${found[0].name} (${ipPort})`);
        } else if (found.length > 1) {
            const sel = await vscode.window.showQuickPick(found.map(f => ({
                label: `$(device-mobile) ${f.name}`,
                description: `IP: ${f.ipPort}`,
                target: f.ipPort
            })), { placeHolder: 'Select the device appearing on your phone screen:' });
            if (sel) ipPort = sel.target;
        }

        if (!ipPort) {
            ipPort = await vscode.window.showInputBox({
                prompt: `No devices found automatically on ${selectedNetwork.label}. You may enter the IP:Port manually:`,
                placeHolder: 'e.g. 192.168.1.5:44321'
            });
        }
    }

    if (!ipPort) return;

    const pairCode = await vscode.window.showInputBox({
        prompt: `Device ${ipPort} found! Enter the 6-digit pair code from your phone:`,
        placeHolder: '123456',
        validateInput: val => val.match(/^\d{6}$/) ? null : 'Pair code must be 6 digits'
    });
    if (!pairCode) return;

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Pairing with ${ipPort}...`,
    }, async () => {
        try {
            const output = await execCommand(`adb pair ${ipPort}`, pairCode);
            if (output.toLowerCase().includes('successfully paired')) {
                vscode.window.showInformationMessage(`Successfully paired with ${ipPort}`);
                // Try automatic connect (adb usually maps connect port 5555)
                const connectIp = ipPort.split(':')[0] + ':5555';
                await execCommand(`adb connect ${connectIp}`);
                provider.refresh();
            } else {
                vscode.window.showErrorMessage(`Pairing failed: ${output}`);
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Error: ${e}`);
        }
    });
}

async function autoDiscoverConnect(provider) {
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Window, // Small loader in bottom bar
        title: "Scanning local networks for ADB devices...",
    }, async () => {
        try {
            const discovered = await discoverAdbServices('connect');
            if (discovered.length === 0) {
                vscode.window.showInformationMessage("No new pairing-ready devices found. Try 'Pair via QR' if your device is new.");
                return;
            }

            let connectedCount = 0;
            for (const dev of discovered) {
                const out = await execCommand(`adb connect ${dev.ipPort}`);
                if (out.includes('connected to')) connectedCount++;
            }

            if (connectedCount > 0) {
                vscode.window.showInformationMessage(`Automatically connected to ${connectedCount} device(s).`);
                provider.refresh();
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Auto-Connect Error: ${e}`);
        }
    });
}

async function connectDevice(provider, device) {
    let ipPort = device ? device.id : await vscode.window.showInputBox({
        prompt: 'Enter IP:Port of the device to connect',
        placeHolder: '192.168.1.5:5555'
    });

    if (!ipPort) return;

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Connecting to ${ipPort}...`,
    }, async () => {
        try {
            const output = await execCommand(`adb connect ${ipPort}`);
            if (output.includes('connected to')) {
                vscode.window.showInformationMessage(`Device connected: ${ipPort}`);
            } else {
                vscode.window.showErrorMessage(`Failed: ${output}`);
            }
            provider.refresh();
        } catch (e) {
            vscode.window.showErrorMessage(`Error: ${e}`);
        }
    });
}

async function switchToWireless(device, provider) {
    const deviceId = device.id;
    try {
        vscode.window.showInformationMessage(`Enabling TCP mode for ${deviceId}...`);
        await execCommand(`adb -s ${deviceId} tcpip 5555`);

        const ip = await getDeviceIp(deviceId);
        if (!ip) {
            vscode.window.showErrorMessage('Could not find device IP.');
            return;
        }

        const out = await execCommand(`adb connect ${ip}:5555`);
        vscode.window.showInformationMessage(out);
        provider.refresh();
    } catch (e) {
        vscode.window.showErrorMessage(`Switch Error: ${e}`);
    }
}

async function openLogcat(device) {
    const termName = `Logcat: ${device.model || device.id}`;
    let terminal = vscode.window.terminals.find(t => t.name === termName);
    if (!terminal) {
        terminal = vscode.window.createTerminal(termName);
    }
    terminal.show();
    terminal.sendText(`adb -s ${device.id} logcat`);
}

async function takeScreenshot(device) {
    try {
        const time = new Date().getTime();
        const filename = `screenshot_${device.model}_${time}.png`.replace(/\s+/g, '_');
        const defaultPath = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : nPath.join(require('os').homedir(), 'Downloads');
        const savePath = nPath.join(defaultPath, filename);

        vscode.window.showInformationMessage('Capturing screenshot...');
        await execCommand(`adb -s ${device.id} exec-out screencap -p > "${savePath}"`);

        const open = await vscode.window.showInformationMessage(`Screenshot saved to ${savePath}`, 'Open File');
        if (open === 'Open File') {
            vscode.commands.executeCommand('vscode.open', vscode.Uri.file(savePath));
        }
    } catch (e) {
        vscode.window.showErrorMessage(`Screenshot Error: ${e}`);
    }
}

async function rebootDevice(device, provider) {
    const confirm = await vscode.window.showWarningMessage(`Are you sure?`, 'Yes', 'No');
    if (confirm !== 'Yes') return;
    try {
        await execCommand(`adb -s ${device.id} reboot`);
        provider.refresh();
    } catch (e) { vscode.window.showErrorMessage(e); }
}

async function wirelessPairingQr(provider) {
    const QRCode = require('qrcode');
    const pairCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Create and show a new webview
    const panel = vscode.window.createWebviewPanel(
        'wirelessPairing',
        'ADB Wireless Pairing',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    try {
        const os = require('os');
        const qrString = `WIFI:T:ADB;S:VSCode-${os.hostname()};P:${pairCode};;`;
        const qrDataUrl = await QRCode.toDataURL(qrString);

        panel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: -apple-system; padding: 30px; color: #ccc; background: #1e1e1e; text-align: center; }
                    .qr-card { background: white; padding: 20px; border-radius: 12px; margin: 20px auto; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
                    .pin { font-size: 3em; font-weight: bold; color: #569cd6; letter-spacing: 6px; margin: 15px 0; font-family: monospace; }
                    .steps { text-align: left; max-width: 420px; margin: 25px auto; background: #252526; padding: 25px; border-radius: 10px; border: 1px solid #333; }
                    .step { margin: 15px 0; font-size: 1.1em; }
                    b { color: #569cd6; }
                    .loader-fix { color: #f1c40f; font-size: 0.9em; margin-top: 25px; background: rgba(241, 196, 15, 0.1); padding: 15px; border-radius: 5px; border: 1px dashed #f1c40f; }
                    h1 { font-weight: 300; margin-bottom: 0; }
                </style>
            </head>
            <body>
                <h1>ADB Wireless Pairing</h1>
                <p style="color: #888; margin-top: 5px;">Scan this with your phone to start</p>

                <div class="qr-card">
                    <img src="${qrDataUrl}" width="220" height="220" />
                </div>

                <div style="text-transform: uppercase; font-size: 0.8em; color: #888;">Pairing Code</div>
                <div class="pin">${pairCode}</div>

                <div class="steps">
                    <div class="step">1. <b>Developer Options</b> > <b>Wireless Debugging</b></div>
                    <div class="step">2. Tap <b>Pair device with QR code</b></div>
                    <div class="step">3. Scan the image above</div>
                </div>

                <div class="loader-fix">
                    <b>Phone stuck on "Pairing..."?</b><br/>
                    This happens if your network blocks discovery. <br/>
                    <b>To Fix:</b> Close this tab and select <b>"Pair Device via Code"</b> <br/>
                    from the sidebar to use the manual IP method.
                </div>
            </body>
            </html>
        `;

        const ipPort = await vscode.window.showInputBox({
            prompt: 'Enter IP:Port shown on device',
            placeHolder: '192.168.1.5:44321'
        });

        if (ipPort) {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Pairing with device...",
                cancellable: false
            }, async () => {
                try {
                    const output = await execCommand(`adb pair ${ipPort}`, pairCode);
                    vscode.window.showInformationMessage(`Success: ${output}`);
                    provider.refresh();
                    panel.dispose();
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed: ${e}`);
                }
            });
        }
    } catch (err) {
        vscode.window.showErrorMessage('Could not generate QR code');
    }
}

async function startLiveView(device) {
    if (!device) return;

    // Get device resolution for coordinate mapping
    let width = 1080, height = 1920;
    try {
        const resOut = await execCommand(`adb -s ${device.id} shell wm size`);
        const match = resOut.match(/Physical size: (\d+)x(\d+)/);
        if (match) {
            width = parseInt(match[1]);
            height = parseInt(match[2]);
        }
    } catch (e) { }

    const panel = vscode.window.createWebviewPanel(
        'adbLiveView',
        `Live: ${device.model || device.id}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    let active = true;
    panel.onDidDispose(() => { active = false; });

    panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { margin: 0; padding: 0; background: #000; display: flex; flex-direction: column; height: 100vh; color: #fff; font-family: sans-serif; overflow: hidden; user-select: none; }
                #header { padding: 10px; background: #1e1e1e; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; z-index: 10; }
                #screen-container { flex: 1; display: flex; justify-content: center; align-items: center; overflow: hidden; padding: 0; position: relative; }
                #screen { max-width: 100%; max-height: 100%; cursor: crosshair; image-rendering: pixelated; }
                .status { font-size: 0.8em; color: #888; }
                .btn { background: #333; color: #eee; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; margin-left: 5px; font-size: 0.8em; }
                .btn:hover { background: #444; }
            </style>
        </head>
        <body>
            <div id="header">
                <div><b>${device.model || device.id}</b> <span class="status" id="fps">Syncing...</span></div>
                <div>
                    <button class="btn" onclick="sendKey('66')">Enter</button>
                    <button class="btn" onclick="sendKey('4')">Back</button>
                    <button class="btn" onclick="sendKey('3')">Home</button>
                    <button class="btn" onclick="toggleFit()">Toggle Fit</button>
                </div>
            </div>
            <div id="screen-container">
                <img id="screen" src="" draggable="false" />
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const screen = document.getElementById('screen');
                const fpsLabel = document.getElementById('fps');
                const devWidth = ${width};
                const devHeight = ${height};
                
                let lastFrameTime = Date.now();
                let isMouseDown = false;
                let startPos = {x:0, y:0};
                let fitToScreen = true;

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'frame') {
                        screen.src = 'data:image/png;base64,' + message.data;
                        const now = Date.now();
                        fpsLabel.innerText = Math.round(1000 / (now - lastFrameTime)) + ' FPS';
                        lastFrameTime = now;
                        vscode.postMessage({ type: 'next' });
                    }
                });

                function getCoords(e) {
                    const rect = screen.getBoundingClientRect();
                    const x = Math.round(((e.clientX - rect.left) / rect.width) * devWidth);
                    const y = Math.round(((e.clientY - rect.top) / rect.height) * devHeight);
                    return {x, y};
                }

                screen.onmousedown = (e) => {
                    isMouseDown = true;
                    startPos = getCoords(e);
                };

                screen.onmouseup = (e) => {
                    if (!isMouseDown) return;
                    isMouseDown = false;
                    const endPos = getCoords(e);
                    const dist = Math.sqrt(Math.pow(endPos.x - startPos.x, 2) + Math.pow(endPos.y - startPos.y, 2));
                    
                    if (dist < 10) {
                        vscode.postMessage({ type: 'tap', x: endPos.x, y: endPos.y });
                    } else {
                        vscode.postMessage({ type: 'swipe', x1: startPos.x, y1: startPos.y, x2: endPos.x, y2: endPos.y });
                    }
                };

                function sendKey(code) { vscode.postMessage({ type: 'key', code }); }
                function toggleFit() {
                    fitToScreen = !fitToScreen;
                    screen.style.maxHeight = fitToScreen ? '100%' : 'none';
                    screen.style.maxWidth = fitToScreen ? '100%' : 'none';
                }

                vscode.postMessage({ type: 'next' });
            </script>
        </body>
        </html>
    `;

    panel.webview.onDidReceiveMessage(async message => {
        if (!active) return;

        switch (message.type) {
            case 'next':
                const { spawn } = require('child_process');
                const adb = spawn('adb', ['-s', device.id, 'exec-out', 'screencap', '-p']);
                let chunks = [];
                adb.stdout.on('data', chunk => chunks.push(chunk));
                adb.on('close', () => {
                    if (active) {
                        const buffer = Buffer.concat(chunks);
                        panel.webview.postMessage({ type: 'frame', data: buffer.toString('base64') });
                    }
                });
                break;
            case 'tap':
                execCommand(`adb -s ${device.id} shell input tap ${message.x} ${message.y}`);
                break;
            case 'swipe':
                execCommand(`adb -s ${device.id} shell input swipe ${message.x1} ${message.y1} ${message.x2} ${message.y2} 300`);
                break;
            case 'key':
                execCommand(`adb -s ${device.id} shell input keyevent ${message.code}`);
                break;
        }
    });
}


module.exports = {
    mirrorDevice, disconnectDevice, pairDevice, connectDevice,
    switchToWireless, openLogcat, takeScreenshot, rebootDevice, wirelessPairingQr,
    startLiveView, autoDiscoverConnect
};

