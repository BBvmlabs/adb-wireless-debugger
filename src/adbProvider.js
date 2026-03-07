const vscode = require('vscode');
const { getAdbDevices, getCurrentNetwork, discoverAdbServices } = require('./utils');

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
        setInterval(async () => {
            const pairing = await discoverAdbServices('pairing');
            const connecting = await discoverAdbServices('connect');

            // Combine and mark types
            this.discovered = [
                ...pairing.map(d => ({ ...d, discoveryType: 'pairing', id: d.ipPort })),
                ...connecting.map(d => ({ ...d, discoveryType: 'connect', id: d.ipPort }))
            ];

            // Only refresh if discovery is currently expanded or seen
            this.refresh();
        }, 5000); // Scan every 5 seconds
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        if (element.isSection) {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = element.contextValue;
            return item;
        }

        if (element.discoveryType) {
            const item = new vscode.TreeItem(
                element.name || 'Unknown Device',
                vscode.TreeItemCollapsibleState.None
            );
            item.description = `${element.discoveryType === 'pairing' ? 'Ready to Pair' : 'Available to Connect'} (${element.ipPort})`;
            item.iconPath = new vscode.ThemeIcon(element.discoveryType === 'pairing' ? 'star-empty' : 'broadcast');
            item.contextValue = element.discoveryType === 'pairing' ? 'discoveredPairing' : 'discoveredConnect';
            item.tooltip = `Auto-discovered via mDNS\nType: ${element.discoveryType}\nTarget: ${element.ipPort}`;
            return item;
        }

        const isHistory = element.state === 'offline';
        const title = element.model || element.id;
        const version = element.version ? ` [A${element.version}]` : '';
        const battery = element.battery ? ` (${element.battery}%)` : '';

        const item = new vscode.TreeItem(
            `${title}${version}${isHistory ? ' [History]' : ''}`,
            vscode.TreeItemCollapsibleState.None
        );

        item.description = isHistory ? `Network: ${element.network || 'Unknown'}` : `${element.state}${battery}`;
        item.tooltip = `ID: ${element.id}\nModel: ${element.model || 'Unknown'}\nAndroid: ${element.version || '?'}\nBattery: ${element.battery || '?'}\nConnection: ${element.type}\nStatus: ${element.state}`;

        if (isHistory) {
            item.iconPath = new vscode.ThemeIcon('history');
            item.contextValue = 'recentDevice';
        } else {
            item.iconPath = element.type === 'usb' ? new vscode.ThemeIcon('symbol-property') : new vscode.ThemeIcon('remote-explorer-item');
            item.contextValue = element.type === 'usb' ? 'connectedDeviceUsb' : 'connectedDeviceWireless';
        }

        return item;
    }

    async getChildren(element) {
        if (!element) {
            // Root elements: Sections
            return [
                { isSection: true, label: 'Connected', contextValue: 'section' },
                { isSection: true, label: 'Discovered (Nearby)', contextValue: 'discoveryHeader' },
                { isSection: true, label: 'History / Recent', contextValue: 'historyHeader' }
            ];
        }

        if (element.label === 'Connected') {
            this.devices = await getAdbDevices();
            this.saveToHistory(this.devices);
            return this.devices;
        }

        if (element.label === 'Discovered (Nearby)') {
            return this.discovered;
        }

        if (element.label === 'History / Recent') {
            return this.getHistory();
        }

        return [];
    }

    saveToHistory(activeDevices) {
        const history = this.context.globalState.get('adbRecentDevices', []);
        const net = getCurrentNetwork();

        activeDevices.forEach(d => {
            if (d.state !== 'device') return;

            const existingIndex = history.findIndex(h => h.id === d.id);
            const entry = {
                id: d.id,
                model: d.model,
                version: d.version,
                type: d.type,
                network: net.id,
                lastSeen: new Date().getTime(),
                state: 'offline'
            };

            if (existingIndex > -1) {
                history[existingIndex] = entry;
            } else {
                history.push(entry);
            }
        });

        // Limit to last 10 devices
        const sortedHistory = history.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 10);
        this.context.globalState.update('adbRecentDevices', sortedHistory);
    }

    getHistory() {
        return this.context.globalState.get('adbRecentDevices', []);
    }

    clearHistory() {
        this.context.globalState.update('adbRecentDevices', []);
        this.refresh();
    }
}

module.exports = { AdbDeviceProvider };
