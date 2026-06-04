# ADB Wireless Debugger VS Code Extension

An elegant and powerful Visual Studio Code extension to simplify wireless debugging of Android devices using ADB. Easily connect, pair (via Code or QR), view logs, and mirror your device screen seamlessly in real time!

## 🚀 What's New in Version 1.1.0

### 📺 Buttery Smooth Live View (Screen Mirroring)
- **High-Performance Streaming:** Fully redesigned live-view screen mirroring streaming at **30+ FPS**.
- **Native H.264 Video Stream:** Uses high-efficiency continuous `adb exec-out screenrecord` parsed and played natively using `jmuxer` in a VS Code webview.
- **Low Latency:** Experience seamless screen mirror interaction with minimal delay.

### ⚡ Elegant Webview Sidebar Dashboard
- A sleek, unified control panel in the VS Code Sidebar.
- Quick actions for connecting, pairing, and managing devices.
- Support for **Auto-Discovery**, **Pair via QR**, **Pair via Code**, and **Direct IP Connection**.

### 🔍 Smart Network Auto-Discovery
- Automatically scans your local area network (LAN) for debug-ready Android devices.
- Leverages mDNS/DNS-SD (Bonjour) and ARP table lookups for swift detection.
- Click to connect or pair immediately without manually keying in IPs.

### 🔋 Rich Device Insights & Inline Controls
- View device states, release versions, and **real-time battery percentage indicators**.
- Quick, inline action buttons to:
  - **Live View** (Internal Screen Mirror)
  - **Logcat** (Streams logs to VS Code Debug Console)
  - **Disconnect** wireless devices
  - **Delete History** items

---

## 🛠️ Requirements

1. **ADB (Android Debug Bridge)** must be installed and added to your system's environment `PATH` variable.
2. An Android device on the same local network with **Wireless Debugging** enabled (found under Developer Options).
3. (Optional) For external screen mirroring via windowed mode, [scrcpy](https://github.com/Genymobile/scrcpy) can be installed on your system.

---

## 📖 Usage & Commands

### Sidebar Panel Buttons
Open the **ADB Wireless** tab in the Activity Bar to access the control panel:
- **Auto-Discover & Connect:** Scan network and connect to visible debugging endpoints automatically.
- **Pair via QR:** Displays a QR code terminal to pair your phone instantly by scanning it using your device's Wireless Debugging QR code scanner.
- **Pair via Code:** Enter the 6-digit pair code from your developer options screen.
- **Connect IP:** Direct connect input by typing device IP and port.
- **Refresh:** Reload the active device tree.
- **Clear History:** Erase all stored device connection histories.

### Context Actions on Device List
Right-click or hover over a device in the tree view to access:
- **Live View (30+ FPS):** Stream phone screen directly into a VS Code tab.
- **Open Logcat:** Stream Android system logs into a dedicated VS Code console window.
- **Switch to Wireless mode:** Enable wireless debugging on a USB-connected device.
- **Take Screenshot:** Instantly capture the device screen.
- **Reboot Device:** Perform a system reboot command via ADB.

---

## 📝 License

MIT License © 2026 BBVMLABS
