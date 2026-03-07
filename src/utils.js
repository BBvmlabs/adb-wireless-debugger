const os = require('os');
const { exec } = require('child_process');

function execCommand(command, input) {
    return new Promise((resolve, reject) => {
        const child = exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
            if (error) {
                // Return stderr if it contains meaningful error but stdout is empty
                reject(stderr.trim() || error.message);
            } else {
                resolve(stdout.trim());
            }
        });
        if (input) {
            child.stdin.write(input + '\n');
            child.stdin.end();
        }
    });
}

function getAllNetworks() {
    const nets = os.networkInterfaces();
    const results = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                const parts = net.address.split('.');
                results.push({
                    name: name,
                    address: net.address,
                    subnet: parts.slice(0, 3).join('.') + '.x'
                });
            }
        }
    }
    return results.length > 0 ? results : [{ name: 'None', address: '0.0.0.0', subnet: 'unknown' }];
}

function getCurrentNetwork() {
    const all = getAllNetworks();
    return all[0];
}

async function getAdbDevices() {
    try {
        const stdout = await execCommand('adb devices -l');
        const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('List of devices'));

        const devices = lines.map(line => {
            const parts = line.split(/\s+/);
            const id = parts[0];
            const state = parts[1];
            const extra = {};
            parts.slice(2).forEach(p => {
                const [key, val] = p.split(':');
                if (key && val) extra[key] = val;
            });
            return { id, state, model: extra.model || id, product: extra.product, type: id.includes('.') ? 'wireless' : 'usb' };
        });

        // Get battery and version for each online device
        const enrichedDevices = await Promise.all(devices.map(async device => {
            if (device.state === 'device') {
                try {
                    const [battery, version] = await Promise.all([
                        execCommand(`adb -s ${device.id} shell dumpsys battery | grep level`).then(out => out.split(':')[1]?.trim() || '?'),
                        execCommand(`adb -s ${device.id} shell getprop ro.build.version.release`).then(out => out.trim() || '?')
                    ]);
                    return { ...device, battery, version };
                } catch (e) {
                    return device;
                }
            }
            return device;
        }));

        return enrichedDevices;
    } catch (error) {
        return [];
    }
}

async function getDeviceIp(deviceId) {
    try {
        const output = await execCommand(`adb -s ${deviceId} shell ip route`);
        // Example: 192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.5
        const match = output.match(/src\s+([0-9.]+)/);
        if (match && match[1]) return match[1];

        // Fallback or secondary method
        const output2 = await execCommand(`adb -s ${deviceId} shell ip addr show wlan0`);
        const match2 = output2.match(/inet\s+([0-9.]+)/);
        if (match2 && match2[1]) return match2[1];

        return null;
    } catch (e) {
        return null;
    }
}

async function discoverAdbServices(type = 'connect') {
    const serviceType = type === 'pairing' ? '_adb-tls-pairing' : '_adb-tls-connect';
    try {
        const output = await execCommand('adb mdns services');
        const discovered = [];

        // Match both IP:Port and potential service names at the end of the line
        // Example: adb-device-name _adb-tls-connect._tcp 192.168.1.5:39247
        const lines = output.split('\n');
        for (const line of lines) {
            if (line.includes(serviceType)) {
                const match = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+)/);
                const nameMatch = line.match(/^([^\s]+)/);
                if (match) {
                    discovered.push({
                        name: nameMatch ? nameMatch[1] : 'Device',
                        ipPort: match[1]
                    });
                }
            }
        }
        return discovered;
    } catch (e) {
        return [];
    }
}

module.exports = { execCommand, getAdbDevices, getDeviceIp, getCurrentNetwork, getAllNetworks, discoverAdbServices };
