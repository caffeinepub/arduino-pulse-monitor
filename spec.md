# Arduino Pulse Rate Monitor

## Current State
New project. No existing code.

## Requested Changes (Diff)

### Add
- Web Bluetooth API integration to connect to HC-05/HC-06 Arduino Bluetooth module
- Real-time BPM display from Arduino pulse sensor data
- Bluetooth status indicator (Connected / Not Connected)
- Sensor status indicator (Connected / Not Connected)
- "Connect Bluetooth" button that triggers device scan/pairing
- State: if BT not connected, show "Connect to Bluetooth Module"
- State: if BT connected but no sensor data, show "Pulse Sensor Not Connected"
- State: if sensor data received, display real BPM value
- Serial data parser to read BPM lines sent from Arduino over BT serial (Nordic UART Service or SPP)
- Auto-reconnect / continuous polling of incoming serial data

### Modify
N/A

### Remove
N/A

## Implementation Plan
1. Backend: minimal stub (no backend logic needed for this app)
2. Frontend:
   - Connect to Bluetooth using Web Bluetooth API (Nordic UART Service UUID for serial-over-BLE)
   - Parse incoming serial lines for BPM integer values
   - Display BPM in large text, or status messages based on connection/sensor state
   - Bluetooth + Sensor status badges
   - Connect button that opens browser BT device picker
   - Disconnect button when connected
   - No fake/simulated data -- only display values received from device
