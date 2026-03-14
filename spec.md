# FitLife Tracker

## Current State
A web-based Arduino pulse monitor (PulseMonitor) with:
- Web Bluetooth connection (NUS service)
- Real-time BPM display with count-up animation, heartbeat icon, pulse rings
- Health alerts for abnormal BPM (<50 or >120)
- Heart Health Exercises accordion section
- GPU-accelerated CSS animations, crimson/blue background

## Requested Changes (Diff)

### Add
- Rename app from "PulseMonitor" to "FitLife Tracker"
- Bluetooth device scanning list: show nearby discovered devices before connecting; user taps a device to connect
- Auto-reconnect logic: if device disconnects unexpectedly, attempt automatic reconnection up to 3 times
- Pulse history graph: show last 30 BPM readings as a sparkline/line chart below the BPM display
- Health alert threshold update: warn below 60 BPM (currently 50) or above 120 BPM
- Breathing/yoga suggestion card when abnormal pulse detected (in addition to toast)

### Modify
- Connect flow: clicking "Scan Bluetooth Devices" opens a dialog/sheet listing discovered devices; user selects HC-05 from list to connect
- Header branding: "FitLife Tracker" with a fitness icon
- ALERT_LOW threshold: change from 50 to 60

### Remove
- Nothing removed

## Implementation Plan
1. Update app name/branding to FitLife Tracker throughout
2. Change ALERT_LOW from 50 to 60
3. Add device scan dialog: use requestDevice with acceptAllDevices, show device picker as a custom list UI (simulate by using the browser native picker — Web Bluetooth API does not allow custom device lists in the browser; note this to user)
4. Add auto-reconnect: on gattserverdisconnected, try reconnect up to 3 times with 2s delay before calling handleDisconnect
5. Add BPM history state (last 30 readings) and render as a simple SVG sparkline chart below BPM display
6. Add inline breathing/yoga suggestion card that appears when BPM is abnormal (below 60 or above 120)
