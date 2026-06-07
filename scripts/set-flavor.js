const fs = require('fs');
const path = require('path');

const targetFlavor = process.argv[2];
if (targetFlavor !== 'dev' && targetFlavor !== 'prod') {
    console.error('Usage: node set-flavor.js <dev|prod>');
    process.exit(1);
}

const rootDir = path.join(__dirname, '..');
const filesToProcess = [
    { filePath: path.join(rootDir, 'package.json'), isJson: true },
    { filePath: path.join(rootDir, 'extension.js'), isJson: false },
    { filePath: path.join(rootDir, 'src', 'adbCommands.js'), isJson: false },
    { filePath: path.join(rootDir, 'src', 'adbToolbarProvider.js'), isJson: false }
];

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizePkg(pkg) {
    // Strip dev- prefix from name
    if (pkg.name.startsWith('dev-')) pkg.name = pkg.name.slice(4);
    // Strip "Dev " prefix from displayName
    if (pkg.displayName.startsWith('Dev ')) pkg.displayName = pkg.displayName.slice(4);
    // Strip "Dev-" from the views name
    if (pkg.contributes?.views) {
        for (const viewGroup of Object.values(pkg.contributes.views)) {
            for (const view of viewGroup) {
                if (typeof view.name === 'string' && view.name.startsWith('Dev-')) {
                    view.name = view.name.slice(4);
                }
            }
        }
    }
    return pkg;
}

function normalizeStr(str) {
    return str
        .replace(/dev\.wirelessDebug\./g, 'wirelessDebug.')
        .replace(/dev-adbDevices/g, 'adbDevices')
        .replace(/dev-adbToolbar(?!Provider)/g, 'adbToolbar')
        .replace(/dev-adb-wireless-view/g, 'adb-wireless-view');
}

function applyDevPkg(pkg) {
    if (!pkg.name.startsWith('dev-')) pkg.name = 'dev-' + pkg.name;
    if (!pkg.displayName.startsWith('Dev ')) pkg.displayName = 'Dev ' + pkg.displayName;
    // Prefix the sidebar view name with "Dev-"
    if (pkg.contributes?.views) {
        for (const viewGroup of Object.values(pkg.contributes.views)) {
            for (const view of viewGroup) {
                if (typeof view.name === 'string' && !view.name.startsWith('Dev-')) {
                    view.name = 'Dev-' + view.name;
                }
            }
        }
    }
    return pkg;
}

function applyDevStr(str) {
    return str
        .replace(/wirelessDebug\./g, 'dev.wirelessDebug.')
        .replace(/adbDevices/g, 'dev-adbDevices')
        .replace(/adbToolbar(?!Provider)/g, 'dev-adbToolbar')
        .replace(/adb-wireless-view/g, 'dev-adb-wireless-view');
}

// ── Main ───────────────────────────────────────────────────────────────────

filesToProcess.forEach(file => {
    if (!fs.existsSync(file.filePath)) {
        console.warn(`File not found: ${file.filePath}`);
        return;
    }

    const rawContent = fs.readFileSync(file.filePath, 'utf8');
    let output;

    if (file.isJson) {
        let pkg = JSON.parse(rawContent);
        pkg = normalizePkg(pkg);                           // always reset to prod
        if (targetFlavor === 'dev') pkg = applyDevPkg(pkg); // then apply dev on top
        // Re-serialize, then fix string identifiers
        let pkgStr = JSON.stringify(pkg, null, 2);
        pkgStr = normalizeStr(pkgStr);                     // reset identifiers
        if (targetFlavor === 'dev') pkgStr = applyDevStr(pkgStr); // apply dev identifiers
        output = pkgStr;
    } else {
        output = normalizeStr(rawContent);
        if (targetFlavor === 'dev') output = applyDevStr(output);
    }

    fs.writeFileSync(file.filePath, output, 'utf8');
    console.log(`[${targetFlavor.toUpperCase()}] Updated ${path.basename(file.filePath)}`);
});

console.log(`\nFlavor set to: ${targetFlavor.toUpperCase()} ✓`);
