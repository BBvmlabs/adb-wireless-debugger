const os = require('os');
const { exec, spawn } = require('child_process');

function execCommand(command, input) {
    return new Promise((resolve, reject) => {
        const child = exec(command, { timeout: 12000 }, (error, stdout, stderr) => {
            if (error) {
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
                    subnet: parts.slice(0, 3).join('.') + '.x',
                    base: parts.slice(0, 3).join('.')
                });
            }
        }
    }
    return results.length > 0 ? results : [{ name: 'None', address: '0.0.0.0', subnet: 'unknown', base: '0.0.0' }];
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
            return {
                id, state,
                model: extra.model ? extra.model.replace(/_/g, ' ') : id,
                product: extra.product,
                type: id.includes('.') || (id.includes(':') && !id.startsWith('emulator')) ? 'wireless' : 'usb'
            };
        });

        const enrichedDevices = await Promise.all(devices.map(async device => {
            if (device.state === 'device') {
                try {
                    const [batteryOut, version] = await Promise.all([
                        // Run grep ON the device (works on Windows too since shell runs on Android)
                        execCommand(`adb -s ${device.id} shell dumpsys battery`)
                            .catch(() => ''),
                        execCommand(`adb -s ${device.id} shell getprop ro.build.version.release`)
                            .then(out => out.trim() || '?').catch(() => '?')
                    ]);
                    // Parse battery level from the full dumpsys output using JS regex
                    const batteryMatch = batteryOut.match(/level:\s*(\d+)/);
                    const battery = batteryMatch ? batteryMatch[1] : '?';
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
        const match = output.match(/src\s+([0-9.]+)/);
        if (match && match[1]) return match[1];

        const output2 = await execCommand(`adb -s ${deviceId} shell ip addr show wlan0`);
        const match2 = output2.match(/inet\s+([0-9.]+)/);
        if (match2 && match2[1]) return match2[1];

        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Enhanced mDNS discovery using `adb mdns services`.
 * Falls back to parsing service names without IPs (Android 11 bug workaround).
 */
async function discoverAdbServices(type = 'connect') {
    const serviceType = type === 'pairing' ? '_adb-tls-pairing' : '_adb-tls-connect';
    const results = [];

    try {
        const output = await execCommand('adb mdns services');
        const lines = output.split('\n');

        for (const line of lines) {
            if (!line.includes(serviceType)) continue;

            // Format 1: name  _adb-tls-connect._tcp  192.168.x.x:PORT
            const ipPortMatch = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+)/);
            const nameMatch = line.match(/^([^\s]+)/);

            if (ipPortMatch) {
                results.push({
                    name: nameMatch ? nameMatch[1] : 'Device',
                    ipPort: ipPortMatch[1]
                });
                continue;
            }

            // Format 2 (Android 11 bug): name  _adb-tls-connect._tcp  hostname:PORT (no IP)
            // Try to resolve hostname to IP
            const hostPortMatch = line.match(/\s+([^\s]+):(\d+)\s*$/);
            if (hostPortMatch) {
                const hostname = hostPortMatch[1];
                const port = hostPortMatch[2];
                try {
                    const ip = await resolveHostname(hostname);
                    if (ip) {
                        results.push({
                            name: nameMatch ? nameMatch[1] : hostname,
                            ipPort: `${ip}:${port}`
                        });
                    }
                } catch (e) { /* unresolvable */ }
            }
        }
    } catch (e) {
        // adb mdns services failed entirely — try fallback
    }

    // Fallback: if we got nothing from mdns, attempt ARP-table scan
    if (results.length === 0 && type === 'connect') {
        const arpResults = await discoverViaArp();
        results.push(...arpResults);
    }

    return results;
}

/**
 * Resolve a hostname to an IPv4 address using DNS.
 */
function resolveHostname(hostname) {
    return new Promise((resolve) => {
        const dns = require('dns');
        dns.lookup(hostname, { family: 4 }, (err, address) => {
            if (err || !address) resolve(null);
            else resolve(address);
        });
    });
}

/**
 * ARP table scan — finds devices on the LAN that have recent ARP entries.
 * Then checks if port 5555 (default ADB) is open by attempting adb connect.
 */
async function discoverViaArp() {
    const results = [];
    try {
        const arpOut = await execCommand('arp -a');
        const ipMatches = arpOut.matchAll(/\((\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\)/g);
        const ips = [...ipMatches].map(m => m[1]);

        // Filter IPs on same subnet as our interface
        const networks = getAllNetworks();
        const ourBases = new Set(networks.map(n => n.base));

        const localIps = ips.filter(ip => {
            const base = ip.split('.').slice(0, 3).join('.');
            return ourBases.has(base);
        });

        // Try connecting to ADB port 5555 in parallel
        const checks = await Promise.allSettled(
            localIps.map(ip => execCommand(`adb connect ${ip}:5555`))
        );

        checks.forEach((result, idx) => {
            if (result.status === 'fulfilled' && result.value.includes('connected to')) {
                results.push({ name: localIps[idx], ipPort: `${localIps[idx]}:5555` });
            }
        });
    } catch (e) { /* ARP scan failed */ }
    return results;
}

module.exports = {
    execCommand, getAdbDevices, getDeviceIp, getCurrentNetwork,
    getAllNetworks, discoverAdbServices
};
