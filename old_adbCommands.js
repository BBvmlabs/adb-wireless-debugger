const vscode = require('vscode');
const { exec, spawn } = require('child_process');
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
        await execCommand(`adb disconnect ${deviceId}`);
        vscode.window.showInformationMessage(`Disconnected from ${deviceId}`);
        provider.refresh();
    } catch (e) {
        vscode.window.showErrorMessage(`Error: ${e}`);
    }
}

async function pairDevice(provider, discoveryItem) {
    let ipPort = discoveryItem ? discoveryItem.ipPort : null;

    if (!ipPort) {
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

        let found = [];
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Searching for devices ready to pair...",
        }, async (progress) => {
            for (let attempt = 1; attempt <= 3; attempt++) {
                progress.report({ message: `Attempt ${attempt}/3...` });
                found = await discoverAdbServices('pairing');
                if (found.length > 0) break;
                if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
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
            let inputIp = await vscode.window.showInputBox({
                prompt: `No devices found automatically. Enter device IP (port will be found automatically):`,
                placeHolder: 'e.g. 192.168.1.5'
            });
            if (inputIp) {
                inputIp = inputIp.trim();
                if (inputIp.includes(':')) {
                    ipPort = inputIp;
                } else {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Finding pairing port for ${inputIp}...`,
                    }, async (progress) => {
                        for (let attempt = 1; attempt <= 3; attempt++) {
                            const discovered = await discoverAdbServices('pairing', true);
                            const match = discovered.find(d => d.ipPort.startsWith(`${inputIp}:`));
                            if (match) {
                                ipPort = match.ipPort;
                                break;
                            }
                            if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
                        }
                    });

                    if (!ipPort) {
                        const manualPort = await vscode.window.showInputBox({
                            prompt: `Could not find pairing port. Enter port for ${inputIp}:`,
                            placeHolder: 'e.g. 44321'
                        });
                        if (manualPort) ipPort = `${inputIp}:${manualPort.trim()}`;
                    }
                }
            }
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
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Scanning networks for ADB devices...",
        cancellable: false
    }, async (progress) => {
        try {
            let discovered = [];
            for (let attempt = 1; attempt <= 4; attempt++) {
                progress.report({ message: `Phase 1/2: mDNS discovery (Attempt ${attempt}/4)...` });
                discovered = await discoverAdbServices('connect', true);
                if (discovered.length > 0) break;
                if (attempt < 4) await new Promise(r => setTimeout(r, 2000));
            }

            // Fallback to ARP scan
            if (discovered.length === 0) {
                progress.report({ message: 'Phase 2/2: ARP scan...' });
                discovered = await discoverAdbServices('connect', false);
            }

            if (discovered.length === 0) {
                progress.report({ message: 'Phase 2/2: Subnet IP sweep...' });
                const networks = getAllNetworks();
                const sweepCandidates = [];

                for (const net of networks) {
                    const base = net.address.split('.').slice(0, 3).join('.');
                    for (let i = 1; i <= 254; i++) {
                        sweepCandidates.push(`${base}.${i}:5555`);
                    }
                }

                const batchSize = 20;
                for (let i = 0; i < sweepCandidates.length; i += batchSize) {
                    const batch = sweepCandidates.slice(i, i + batchSize);
                    const results = await Promise.allSettled(
                        batch.map(ip => execCommand(`adb connect ${ip}`).catch(() => ''))
                    );
                    results.forEach((r, idx) => {
                        if (r.status === 'fulfilled' && r.value.includes('connected to')) {
                            discovered.push({ ipPort: batch[idx], name: batch[idx] });
                        }
                    });
                    if (discovered.length > 0) break;
                }
            }

            if (discovered.length === 0) {
                const choice = await vscode.window.showInformationMessage(
                    "No devices found. If Wireless Debugging is ON, your network might be blocking mDNS, or ADB's mDNS cache is stuck.",
                    'Restart ADB Server', 'Pair via Code', 'Pair via QR'
                );

                if (choice === 'Restart ADB Server') {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "Restarting ADB Server..."
                    }, async () => {
                        await execCommand('adb kill-server');
                        await execCommand('adb start-server');
                    });
                    vscode.window.showInformationMessage('ADB Server restarted. Please try Auto-Connect again.');
                    return;
                }
                
                if (choice === 'Pair via Code') vscode.commands.executeCommand('dev.wirelessDebug.pair');
                if (choice === 'Pair via QR') vscode.commands.executeCommand('dev.wirelessDebug.pairQr');
                
                return;
            }

            let connectedCount = 0;
            for (const dev of discovered) {
                try {
                    const out = await execCommand(`adb connect ${dev.ipPort}`);
                    if (out.includes('connected to')) connectedCount++;
                } catch (e) { /* skip */ }
            }

            if (connectedCount > 0) {
                vscode.window.showInformationMessage(`Auto-connected to ${connectedCount} device(s).`);
                provider.refresh();
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Auto-Connect Error: ${e}`);
        }
    });
}

async function connectDevice(provider, device) {
    let defaultVal = '';
    let targetIp = '';

    if (device && device.id) {
        // Clicked from History list
        targetIp = device.id.split(':')[0];
        defaultVal = targetIp;
    } else if (!device && provider && provider.getHistory) {
        // Clicked from toolbar 'Connect IP'
        const history = provider.getHistory();
        if (history.length > 0) {
            targetIp = history[0].id.split(':')[0];
            defaultVal = targetIp;
        }
    }

    let inputIp = await vscode.window.showInputBox({
        prompt: 'Enter device IP (port will be found automatically)',
        value: defaultVal,
        placeHolder: '192.168.1.5'
    });

    if (!inputIp) return;
    inputIp = inputIp.trim();

    let ipPort = inputIp;
    if (!inputIp.includes(':')) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Finding connect port for ${inputIp}...`,
        }, async (progress) => {
            for (let attempt = 1; attempt <= 3; attempt++) {
                const discovered = await discoverAdbServices('connect', true);
                const match = discovered.find(d => d.ipPort.startsWith(`${inputIp}:`));
                if (match) {
                    ipPort = match.ipPort;
                    break;
                }
                if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
            }
            if (!ipPort.includes(':')) {
                // Default to 5555 if not found via mDNS
                ipPort = `${inputIp}:5555`;
            }
        });
    }

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

const activeLogcats = new Map();

async function openLogcat(device) {
    const packageName = await vscode.window.showInputBox({
        prompt: "Enter package name to filter Logcat (leave empty for all)",
        placeHolder: "e.g. com.example.myapp"
    });

    if (packageName === undefined) return; // User cancelled

    if (activeLogcats.has(device.id)) {
        const existing = activeLogcats.get(device.id);
        if (existing.process) {
            try { existing.process.kill(); } catch (e) {}
        }
        if (existing.pollTimeout) clearTimeout(existing.pollTimeout);
        existing.channel.dispose();
        activeLogcats.delete(device.id);
    }

    const outputChannel = vscode.window.createOutputChannel(`Logcat: ${device.model || device.id}`, 'log');
    outputChannel.show(true);
    outputChannel.appendLine(`ΓòöΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòù`);
    outputChannel.appendLine(`Γòæ  Logcat ΓÇö ${(device.model || device.id).padEnd(29)}Γòæ`);
    outputChannel.appendLine(`ΓòÜΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓò¥`);
    
    if (!packageName.trim()) {
        outputChannel.appendLine('');
        const adb = spawn('adb', ['-s', device.id, 'logcat', '-v', 'time', 'color']);
        activeLogcats.set(device.id, { process: adb, channel: outputChannel });
        attachLogcatStreams(adb, outputChannel, device.id);
    } else {
        const pkg = packageName.trim();
        let currentPid = null;
        let adbProc = null;
        
        const entry = { process: null, channel: outputChannel, isPolling: true, pollTimeout: null };
        activeLogcats.set(device.id, entry);
        
        outputChannel.appendLine(`[Searching for process: ${pkg}...]`);

        const startFilteredStream = (pid) => {
            outputChannel.appendLine(`[Process found! PID: ${pid}. Starting stream...]`);
            outputChannel.appendLine('--------------------------------------------------');
            adbProc = spawn('adb', ['-s', device.id, 'logcat', '--pid', pid, '-v', 'time', 'color']);
            
            const currentEntry = activeLogcats.get(device.id);
            if (currentEntry) {
                currentEntry.process = adbProc;
            }

            attachLogcatStreams(adbProc, outputChannel, device.id, (code) => {
                adbProc = null;
                const e = activeLogcats.get(device.id);
                if (e) {
                    e.process = null;
                    e.isPolling = true;
                    outputChannel.appendLine(`\n[Stream for PID ${pid} ended. Waiting for app to restart...]`);
                    currentPid = null;
                    pollForPid();
                }
            });
        };

        const pollForPid = () => {
            const e = activeLogcats.get(device.id);
            if (!e || !e.isPolling) return;

            exec(`adb -s ${device.id} shell pidof ${pkg}`, (err, stdout) => {
                const currentE = activeLogcats.get(device.id);
                if (!currentE || !currentE.isPolling) return;

                const pid = stdout ? stdout.trim() : '';
                if (pid && pid !== currentPid) {
                    currentPid = pid;
                    currentE.isPolling = false;
                    startFilteredStream(pid);
                } else {
                    currentE.pollTimeout = setTimeout(pollForPid, 2000);
                }
            });
        };

        pollForPid();
    }
}

function attachLogcatStreams(adb, outputChannel, deviceId, onClose) {
    let buffer = '';
    let timeout = null;

    adb.stdout.on('data', (data) => {
        buffer += data.toString();
        
        if (!timeout) {
            timeout = setTimeout(() => {
                outputChannel.append(buffer);
                buffer = '';
                timeout = null;
            }, 100);
        }
    });

    adb.stderr.on('data', (data) => {
        outputChannel.append(`[ERROR]: ${data.toString()}`);
    });

    adb.on('close', (code) => {
        if (timeout) {
            clearTimeout(timeout);
            if (buffer) outputChannel.append(buffer);
            timeout = null;
        }
        if (onClose) {
            onClose(code);
        } else {
            outputChannel.appendLine(`\n[Logcat disconnected. Exit code: ${code}]`);
            activeLogcats.delete(deviceId);
        }
    });
}

async function stopLogcat(device) {
    if (activeLogcats.has(device.id)) {
        const existing = activeLogcats.get(device.id);
        if (existing.process) {
            try { existing.process.kill(); } catch (e) {}
        }
        if (existing.pollTimeout) clearTimeout(existing.pollTimeout);
        existing.channel.dispose();
        activeLogcats.delete(device.id);
        vscode.window.showInformationMessage(`Stopped Logcat for ${device.model || device.id}`);
    } else {
        vscode.window.showInformationMessage(`No active Logcat running for ${device.model || device.id}`);
    }
}

async function takeScreenshot(device) {
    try {
        const path = require('path');
        const time = new Date().getTime();
        const filename = `screenshot_${device.model}_${time}.png`.replace(/\s+/g, '_');
        const defaultPath = vscode.workspace.workspaceFolders
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : require('os').homedir();
        const savePath = path.join(defaultPath, filename);

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
    const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to reboot ${device.model || device.id}?`, 'Yes', 'No'
    );
    if (confirm !== 'Yes') return;
    try {
        await execCommand(`adb -s ${device.id} reboot`);
        provider.refresh();
    } catch (e) { vscode.window.showErrorMessage(e); }
}

async function wirelessPairingQr(provider) {
    const QRCode = require('qrcode');
    const pairCode = Math.floor(100000 + Math.random() * 900000).toString();

    const panel = vscode.window.createWebviewPanel(
        'wirelessPairing',
        'ADB Wireless Pairing',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    try {
        const os = require('os');
        const qrString = `WIFI:T:ADB;S:VSCode-${os.hostname()};P:${pairCode};;`;
        const qrDataUrl = await QRCode.toDataURL(qrString, { width: 240, margin: 2 });

        panel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                        font-family: 'Segoe UI', sans-serif; background: #0f0f13; color: #e2e8f0;
                        display: flex; flex-direction: column; align-items: center; justify-content: center;
                        min-height: 100vh; padding: 20px;
                    }
                    .card {
                        background: linear-gradient(145deg, #1a1a2e 0%, #16213e 100%);
                        border: 1px solid rgba(99,179,237,0.15); border-radius: 20px;
                        padding: 44px 40px; text-align: center;
                        box-shadow: 0 25px 60px rgba(0,0,0,0.7); max-width: 480px; width: 100%;
                        animation: fadeUp 0.5s ease;
                    }
                    @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
                    .badge {
                        display: inline-flex; align-items: center; gap: 6px;
                        background: rgba(99,179,237,0.1); border: 1px solid rgba(99,179,237,0.25);
                        color: #63b3ed; font-size: 0.78em; font-weight: 500;
                        padding: 4px 12px; border-radius: 100px; margin-bottom: 20px; letter-spacing: 0.5px;
                    }
                    h1 { font-size: 1.6em; font-weight: 700; color: #fff; margin-bottom: 6px; }
                    .subtitle { color: #718096; font-size: 0.92em; margin-bottom: 30px; }
                    .qr-wrap {
                        background: #fff; padding: 16px; border-radius: 16px;
                        display: inline-flex; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
                        margin-bottom: 28px; transition: transform 0.25s ease;
                    }
                    .qr-wrap:hover { transform: scale(1.04); }
                    .pin-label { font-size: 0.73em; font-weight: 500; letter-spacing: 2px; text-transform: uppercase; color: #4a5568; margin-bottom: 8px; }
                    .pin {
                        font-size: 2.8em; font-weight: 700; color: #63b3ed; letter-spacing: 10px;
                        font-family: 'Courier New', monospace; text-shadow: 0 0 20px rgba(99,179,237,0.4);
                        padding: 10px 20px; background: rgba(99,179,237,0.06); border-radius: 10px;
                        display: inline-block; margin-bottom: 28px;
                    }
                    .steps { text-align: left; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 20px 22px; margin-bottom: 18px; }
                    .step { display: flex; align-items: flex-start; gap: 12px; padding: 8px 0; font-size: 0.93em; color: #a0aec0; border-bottom: 1px solid rgba(255,255,255,0.04); }
                    .step:last-child { border-bottom: none; }
                    .step-num { min-width: 24px; height: 24px; border-radius: 50%; background: rgba(99,179,237,0.15); color: #63b3ed; display: flex; align-items: center; justify-content: center; font-size: 0.78em; font-weight: 700; }
                    .step b { color: #e2e8f0; }
                    .tip { background: rgba(236,201,75,0.06); border: 1px solid rgba(236,201,75,0.2); border-radius: 10px; padding: 14px 16px; font-size: 0.87em; color: #d69e2e; text-align: left; line-height: 1.6; }
                    .tip b { color: #ecc94b; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="badge">ΓÜí ADB Wireless Pairing</div>
                    <h1>Scan to Connect</h1>
                    <p class="subtitle">Open Wireless Debugging on your Android device</p>
                    <div class="qr-wrap"><img src="${qrDataUrl}" width="200" height="200" /></div>
                    <div class="pin-label">Pairing Code</div>
                    <div class="pin">${pairCode}</div>
                    <div class="steps">
                        <div class="step"><span class="step-num">1</span><span><b>Settings</b> ΓåÆ Developer Options ΓåÆ <b>Wireless Debugging</b></span></div>
                        <div class="step"><span class="step-num">2</span><span>Tap <b>"Pair device with QR code"</b></span></div>
                        <div class="step"><span class="step-num">3</span><span>Point your camera at the QR code above</span></div>
                    </div>
                    <div class="tip"><b>Stuck on "PairingΓÇª"?</b> Your network may be blocking mDNS discovery.<br>Use <b>"Pair Device via Code"</b> instead ΓÇö enter the IP:Port manually.</div>
                </div>
            </body>
            </html>
        `;

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Waiting for device to scan QR code...",
            cancellable: true
        }, async (progress, token) => {
            let isCancelled = false;
            token.onCancellationRequested(() => isCancelled = true);

            let paired = false;
            while (!paired && !isCancelled) {
                const discovered = await discoverAdbServices('pairing', true);
                // Try pairing with all discovered pairing services using our pairCode
                for (const dev of discovered) {
                    try {
                        const output = await execCommand(`adb pair ${dev.ipPort}`, pairCode);
                        if (output.toLowerCase().includes('successfully paired')) {
                            vscode.window.showInformationMessage(`Successfully paired with ${dev.ipPort}!`);
                            
                            // Attempt to auto connect
                            const connectIp = dev.ipPort.split(':')[0];
                            const connectServices = await discoverAdbServices('connect', true);
                            const connectDev = connectServices.find(d => d.ipPort.startsWith(`${connectIp}:`));
                            const connectPort = connectDev ? connectDev.ipPort : `${connectIp}:5555`;
                            await execCommand(`adb connect ${connectPort}`);

                            provider.refresh();
                            panel.dispose();
                            paired = true;
                            break;
                        }
                    } catch (e) {
                        // Ignore pairing errors as we might be trying wrong devices
                    }
                }
                if (!paired) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        });
    } catch (err) {
        vscode.window.showErrorMessage('Could not generate QR code');
    }
}

// Live View ΓÇö Sequential capture loop.
// KEY FIX: Only ONE screencap runs at a time with a 150ms cooldown between frames.
// The old setInterval approach ran 15 concurrent screencaps/sec ΓåÆ device overload.
// This approach caps load at ~6 FPS and never queues concurrent processes.
async function startLiveView(device) {
    if (!device) return;

    let width = 1080, height = 1920;
    try {
        const resOut = await execCommand(`adb -s ${device.id} shell wm size`);
        const match = resOut.match(/Physical size: (\d+)x(\d+)/);
        if (match) { width = parseInt(match[1]); height = parseInt(match[2]); }
    } catch (e) { }

    const panel = vscode.window.createWebviewPanel(
        'adbLiveView',
        `≡ƒô▒ ${device.model || device.id}`,
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    let active = true;
    let currentProc = null;

    panel.onDidDispose(() => {
        active = false;
        if (currentProc) { try { currentProc.kill(); } catch (e) {} }
    });

    const fs = require('fs');
    const path = require('path');
    const jmuxerPath = path.join(__dirname, '..', 'node_modules', 'jmuxer', 'dist', 'jmuxer.min.js');
    let jmuxerScript = '';
    if (fs.existsSync(jmuxerPath)) {
        jmuxerScript = fs.readFileSync(jmuxerPath, 'utf8');
    }

    panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
                body {
                    background: #080810; display: flex; flex-direction: column;
                    height: 100vh; color: #e2e8f0; overflow: hidden; user-select: none;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                }
                #toolbar {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 10px 16px; background: rgba(15,15,25,0.95);
                    border-bottom: 1px solid rgba(99,179,237,0.12); backdrop-filter: blur(10px);
                    gap: 12px; flex-shrink: 0;
                }
                .dev-info { display: flex; align-items: center; gap: 10px; min-width: 0; }
                .dev-name { font-size: 1em; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .pill { font-size: 0.72em; font-weight: 600; padding: 3px 9px; border-radius: 100px; white-space: nowrap; flex-shrink: 0; }
                #status-pill { background: rgba(99,179,237,0.12); color: #90cdf4; border: 1px solid rgba(99,179,237,0.25); }
                .controls { display: flex; gap: 6px; flex-shrink: 0; }
                .btn {
                    background: rgba(255,255,255,0.07); color: #e2e8f0;
                    border: 1px solid rgba(255,255,255,0.1); padding: 6px 14px;
                    border-radius: 8px; cursor: pointer; font-size: 0.82em; font-weight: 500;
                    transition: all 0.15s ease; white-space: nowrap;
                }
                .btn:hover { background: rgba(99,179,237,0.15); border-color: rgba(99,179,237,0.3); color: #63b3ed; }
                .btn:active { transform: scale(0.96); }
                #viewport {
                    flex: 1; display: flex; align-items: center; justify-content: center;
                    overflow: hidden; position: relative;
                    background: radial-gradient(ellipse at center, #10101e 0%, #050508 100%);
                }
                #player {
                    max-width: 100%; max-height: 100%; cursor: crosshair; display: block;
                    border-radius: 4px;
                    box-shadow: 0 0 60px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04);
                }
                #overlay-msg { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); text-align: center; pointer-events: none; }
                #overlay-msg .spinner { width: 36px; height: 36px; border: 3px solid rgba(99,179,237,0.15); border-top-color: #63b3ed; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 10px; }
                @keyframes spin { to { transform: rotate(360deg); } }
                #overlay-msg p { color: #718096; font-size: 0.9em; }
            </style>
            <script>${jmuxerScript}</script>
        </head>
        <body>
            <div id="toolbar">
                <div class="dev-info">
                    <span class="dev-name">${device.model || device.id}</span>
                    <span class="pill" id="status-pill">ConnectingΓÇª</span>
                </div>
                <div class="controls">
                    <button class="btn" onclick="sendKey('66')">Γå╡ Enter</button>
                    <button class="btn" onclick="sendKey('4')">ΓùÇ Back</button>
                    <button class="btn" onclick="sendKey('3')">Γîé Home</button>
                    <button class="btn" onclick="sendKey('187')">Γûú Recents</button>
                    <button class="btn" onclick="toggleFit()">Γñó Fit</button>
                </div>
            </div>
            <div id="viewport">
                <video id="player" autoplay muted playsinline></video>
                <div id="overlay-msg">
                    <div class="spinner"></div>
                    <p>Starting video streamΓÇª</p>
                </div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const player = document.getElementById('player');
                const statusPill = document.getElementById('status-pill');
                const overlay = document.getElementById('overlay-msg');
                const devWidth = ${width};
                const devHeight = ${height};

                let isMouseDown = false, startPos = {x:0,y:0}, fitToScreen = true;

                const jmuxer = new JMuxer({
                    node: 'player',
                    mode: 'video',
                    flushingTime: 0,
                    fps: 30,
                    debug: false
                });

                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.type === 'video_data') {
                        if (overlay.style.display !== 'none') overlay.style.display = 'none';
                        if (statusPill.textContent !== 'Live (H.264)') statusPill.textContent = 'Live (H.264)';
                        
                        const binaryString = atob(msg.data);
                        const len = binaryString.length;
                        const bytes = new Uint8Array(len);
                        for (let i = 0; i < len; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        jmuxer.feed({ video: bytes });
                    }
                });

                function getCoords(e) {
                    const rect = player.getBoundingClientRect();
                    return {
                        x: Math.round(((e.clientX - rect.left) / rect.width) * devWidth),
                        y: Math.round(((e.clientY - rect.top) / rect.height) * devHeight)
                    };
                }

                player.addEventListener('mousedown', e => { isMouseDown = true; startPos = getCoords(e); });
                player.addEventListener('mouseup', e => {
                    if (!isMouseDown) return;
                    isMouseDown = false;
                    const end = getCoords(e);
                    const d = Math.hypot(end.x - startPos.x, end.y - startPos.y);
                    if (d < 12) vscode.postMessage({ type: 'tap', x: end.x, y: end.y });
                    else vscode.postMessage({ type: 'swipe', x1: startPos.x, y1: startPos.y, x2: end.x, y2: end.y });
                });
                player.addEventListener('wheel', e => {
                    vscode.postMessage({ type: 'scroll', ...getCoords(e), dir: e.deltaY > 0 ? 1 : -1 });
                }, { passive: true });

                function sendKey(code) { vscode.postMessage({ type: 'key', code }); }
                function toggleFit() {
                    fitToScreen = !fitToScreen;
                    player.style.maxHeight = fitToScreen ? '100%' : 'none';
                    player.style.maxWidth  = fitToScreen ? '100%' : 'none';
                }
            </script>
        </body>
        </html>
    `;

    function startStream() {
        if (!active) return;
        
        // Output raw H.264 stream. Bitrate 2Mbps for smooth wireless.
        const proc = spawn('adb', ['-s', device.id, 'exec-out', 'screenrecord', '--output-format=h264', '--bit-rate', '2000000', '-']);
        currentProc = proc;

        proc.stdout.on('data', chunk => {
            if (!active) return;
            panel.webview.postMessage({ type: 'video_data', data: chunk.toString('base64') });
        });

        proc.on('close', () => {
            currentProc = null;
            if (active) {
                // screenrecord maxes out at 180 seconds, restart automatically
                setTimeout(startStream, 500);
            }
        });
        
        proc.on('error', () => {
            currentProc = null;
            if (active) setTimeout(startStream, 1000);
        });
    }

    startStream();

    panel.webview.onDidReceiveMessage(async message => {
        if (!active) return;
        switch (message.type) {
            case 'tap':
                execCommand(`adb -s ${device.id} shell input tap ${message.x} ${message.y}`);
                break;
            case 'swipe':
                execCommand(`adb -s ${device.id} shell input swipe ${message.x1} ${message.y1} ${message.x2} ${message.y2} 200`);
                break;
            case 'key':
                execCommand(`adb -s ${device.id} shell input keyevent ${message.code}`);
                break;
            case 'scroll':
                execCommand(`adb -s ${device.id} shell input swipe ${message.x} ${message.y} ${message.x} ${message.y - message.dir * 300} 150`);
                break;
        }
    });
}


async function refreshDevicesCommand(provider) {
    provider.refresh();
    
    // Check if anything is found
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: "Refreshing devices..."
    }, async () => {
        try {
            const { getAdbDevices, discoverAdbServices } = require('./utils');
            const devices = await getAdbDevices();
            const pairing = await discoverAdbServices('pairing', true);
            const connect = await discoverAdbServices('connect', true);
            
            if (devices.length === 0 && pairing.length === 0 && connect.length === 0) {
                vscode.window.showInformationMessage("No devices found. Clearing ADB cache and restarting server...");
                await execCommand('adb kill-server');
                await execCommand('adb start-server');
                provider.refresh();
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Refresh Error: ${e}`);
        }
    });
}

module.exports = {
    mirrorDevice, disconnectDevice, pairDevice, connectDevice,
    switchToWireless, openLogcat, stopLogcat, takeScreenshot, rebootDevice, wirelessPairingQr,
    startLiveView, autoDiscoverConnect, refreshDevicesCommand
};
