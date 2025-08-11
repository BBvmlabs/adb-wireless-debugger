# Wireless Debug VS Code Extension

A Visual Studio Code extension to simplify wireless debugging of Android devices using ADB pairing and connecting commands.

## Features

- Lists your active network IP addresses for easy selection
- Prompts for device IP (last digits only) and port number based on your network
- Supports ADB wireless debugging pair code input
- Provides commands to pair and connect your Android device wirelessly
- Works with system hotspot and standard Wi-Fi networks

## Requirements

- [ADB (Android Debug Bridge)](https://developer.android.com/studio/command-line/adb) must be installed and added to your system PATH
- Your Android device should have **Wireless Debugging** enabled and show a pairing code

## Usage

### Commands

- **Wireless Debug: Pair Device**  
  Starts the pairing process:  
  1. Select your network IP (e.g., `192.168.1.1`)  
  2. Enter the last digits of your device IP (e.g., `45`) and port number (usually `5555`)  
  3. Enter the 6-digit wireless debugging pair code shown on your Android device  
  4. Optionally connect immediately by entering device port number again  

- **Wireless Debug: Connect to Device**  
  Connects to your device without pairing:  
  1. Select your network IP  
  2. Enter the last digits of your device IP and port number  
  3. Connects via `adb connect ip:port`  

### Running the commands

1. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)  
2. Type and select `Wireless Debug: Pair Device` or `Wireless Debug: Connect to Device`  
3. Follow the prompts  

## Example

If your network IP is `192.168.1.1`, device IP is `192.168.1.45`, and port is `5555`:

- Select `192.168.1.1` from network list  
- Enter `45` for last digits of device IP  
- Enter `5555` as port number  
- Enter the 6-digit pair code from your device (for pairing)  
- Optionally connect immediately  

ADB commands run under the hood:

```bash
adb pair 192.168.1.45:5555
# (pair code sent as input)
adb connect 192.168.1.45:5555
```

## License

MIT License © 2025 BBVMLABS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
