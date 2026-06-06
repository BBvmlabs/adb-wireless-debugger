const vscode = require('vscode');
const { getAdbDevices, getCurrentNetwork, discoverAdbServices } = require('./utils');

// Section label constants — must match exactly in getChildren()
const SEC_CONNECTED   = 'Connected';
const SEC_DISCOVERED  = 'Discovered (Nearby)';
const SEC_HISTORY     = 'History / Recent';

class AdbDeviceProvider {
    constructor(context) {
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.devices = [];
        this.discovered = [];
        this.startDiscoveryLoop();
    }

    startDiscoveryLoop() {
        this._runDiscovery();
        setInterval(() => this._runDiscovery(), 8000);
    }

    async _runDiscovery() {
        try {
            const [pairing, connecting] = await Promise.all([
                discoverAdbServices('pairing'),
                discoverAdbServices('connect')
            ]);

            const seen = new Set();
            this.discovered = [
                ...pairing.map(d => ({ ...d, discoveryType: 'pairing', id: d.ipPort })),
                ...connecting.map(d => ({ ...d, discoveryType: 'connect', id: d.ipPort }))
            ].filter(d => {
                if (seen.has(d.ipPort)) return false;
                seen.add(d.ipPort);
                return true;
            });

            this.refresh();
        } catch (e) { /* silent */ }
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        // Placeholder items
        if (element.isPlaceholder) {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('info');
            item.contextValue = 'placeholder';
            return item;
        }

        // Section headers
        if (element.isSection) {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = element.contextValue || 'section';
            return item;
        }

        // Discovered nearby devices
        if (element.discoveryType) {
            const isPairing = element.discoveryType === 'pairing';
            const item = new vscode.TreeItem(
                element.name || 'Unknown Device',
                vscode.TreeItemCollapsibleState.None
            );
            item.description = isPairing
                ? `Ready to Pair  ·  ${element.ipPort}`
                : `Tap to Connect  ·  ${element.ipPort}`;
            item.iconPath = new vscode.ThemeIcon(isPairing ? 'star-empty' : 'broadcast');
            item.contextValue = isPairing ? 'discoveredPairing' : 'discoveredConnect';
            item.tooltip = new vscode.MarkdownString(
                `**${element.name || 'Device'}**\n\n` +
                `- Type: \`${element.discoveryType}\`\n` +
                `- Address: \`${element.ipPort}\`\n\n` +
                (isPairing ? '*Click to pair this device*' : '*Click to connect to this device*')
            );
            return item;
        }

        // Active & history devices
        const isHistory = element.state === 'offline';
        const title = element.model || element.id;
        const versionStr = element.version ? ` · A${element.version}` : '';

        const item = new vscode.TreeItem(
            isHistory ? title : `${title}${versionStr}`,
            vscode.TreeItemCollapsibleState.None
        );

        if (isHistory) {
            const lastSeen = element.lastSeen
                ? new Date(element.lastSeen).toLocaleString()
                : 'Unknown';
            item.description = `Offline  ·  ${element.network || 'Unknown network'}`;
            item.iconPath = new vscode.ThemeIcon('history');
            item.contextValue = 'recentDevice';
            item.tooltip = new vscode.MarkdownString(
                `**${title}** *(History)*\n\n` +
                `- ID: \`${element.id}\`\n` +
                `- Last network: \`${element.network || 'Unknown'}\`\n` +
                `- Last seen: ${lastSeen}`
            );
        } else {
            // Battery display — show prominently in description
            const batteryDisplay = element.battery && element.battery !== '?'
                ? `  🔋 ${element.battery}%`
                : '';
            item.description = `${element.state}${batteryDisplay}`;
            item.iconPath = element.type === 'usb'
                ? new vscode.ThemeIcon('plug')
                : new vscode.ThemeIcon('wifi');
            item.contextValue = element.type === 'usb' ? 'connectedDeviceUsb' : 'connectedDeviceWireless';
            item.tooltip = new vscode.MarkdownString(
                `**${title}**\n\n` +
                `| | |\n|---|---|\n` +
                `| ID | \`${element.id}\` |\n` +
                `| Android | ${element.version || '?'} |\n` +
                `| Battery | ${element.battery ? element.battery + '%' : '?'} |\n` +
                `| Type | ${element.type === 'usb' ? '🔌 USB' : '📶 Wireless'} |\n` +
                `| Status | ${element.state} |`
            );
        }

        return item;
    }

    async getChildren(element) {
        if (!element) {
            return [
                { isSection: true, label: SEC_CONNECTED,  contextValue: 'section' },
                { isSection: true, label: SEC_DISCOVERED, contextValue: 'discoveryHeader' },
                { isSection: true, label: SEC_HISTORY,    contextValue: 'historyHeader' }
            ];
        }

        if (element.label === SEC_CONNECTED) {
            this.devices = await getAdbDevices();
            this.saveToHistory(this.devices);
            return this.devices.length > 0
                ? this.devices
                : [{ isPlaceholder: true, label: 'No devices connected' }];
        }

        if (element.label === SEC_DISCOVERED) {
            return this.discovered.length > 0
                ? this.discovered
                : [{ isPlaceholder: true, label: 'Scanning for nearby devices…' }];
        }

        if (element.label === SEC_HISTORY) {
            const hist = this.getHistory();
            return hist.length > 0
                ? hist
                : [{ isPlaceholder: true, label: 'No history yet' }];
        }

        return [];
    }

    saveToHistory(activeDevices) {
        let history = this.context.globalState.get('adbRecentDevices', []);
        const net = getCurrentNetwork();

        activeDevices.forEach(d => {
            if (d.state !== 'device') return;
            const entryIpOrSerial = d.id.split(':')[0];
            
            // Remove existing duplicates for the same device
            history = history.filter(h => {
                const hIpOrSerial = h.id.split(':')[0];
                return !(h.model === d.model && hIpOrSerial === entryIpOrSerial);
            });
            
            const entry = {
                id: d.id,
                model: d.model,
                version: d.version,
                type: d.type,
                // If it's a wireless device (has an IP port), show the device IP instead of the host's subnet IP.
                network: d.id.includes(':') ? d.id.split(':')[0] : (net ? net.name : 'Unknown'),
                lastSeen: Date.now(),
                state: 'offline'
            };
            history.push(entry);
        });

        // Deduplicate any old history that might already have duplicates
        const uniqueHistory = [];
        const seen = new Set();
        for (const h of history) {
            const key = `${h.model}_${h.id.split(':')[0]}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueHistory.push(h);
            }
        }
        
        const sorted = uniqueHistory.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 10);
        this.context.globalState.update('adbRecentDevices', sorted);
    }

    getHistory() {
        return this.context.globalState.get('adbRecentDevices', []);
    }

    clearHistory() {
        this.context.globalState.update('adbRecentDevices', []);
        this.refresh();
    }

    deleteHistoryItem(item) {
        const history = this.context.globalState.get('adbRecentDevices', []);
        const updated = history.filter(h => h.id !== item.id);
        this.context.globalState.update('adbRecentDevices', updated);
        this.refresh();
    }
}

module.exports = { AdbDeviceProvider };
