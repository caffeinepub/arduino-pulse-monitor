import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  Activity,
  AlertCircle,
  Bluetooth,
  BluetoothOff,
  Heart,
  Wifi,
  WifiOff,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type ConnectionState = "disconnected" | "connecting" | "connected";
type SensorState = "waiting" | "connected" | "disconnected";

const SENSOR_TIMEOUT_MS = 5000;
const BPM_MIN = 50;
const BPM_MAX = 220;

// Nordic UART Service UUIDs
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX_CHAR = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // notify

export default function App() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [sensorState, setSensorState] = useState<SensorState>("waiting");
  const [bpm, setBpm] = useState<number | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(
    null,
  );
  const sensorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferRef = useRef<string>("");

  const isWebBluetoothSupported = "bluetooth" in navigator;

  const resetSensorTimeout = useCallback(() => {
    if (sensorTimeoutRef.current) clearTimeout(sensorTimeoutRef.current);
    setSensorState("connected");
    sensorTimeoutRef.current = setTimeout(() => {
      setSensorState("disconnected");
      setBpm(null);
    }, SENSOR_TIMEOUT_MS);
  }, []);

  const parseBpm = useCallback(
    (chunk: string) => {
      bufferRef.current += chunk;
      const lines = bufferRef.current.split("\n");
      bufferRef.current = lines[lines.length - 1];

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        // Handle "BPM:72" or just "72"
        const raw = line.replace(/^BPM:/i, "").trim();
        const value = Number.parseInt(raw, 10);
        if (!Number.isNaN(value) && value >= BPM_MIN && value <= BPM_MAX) {
          setBpm(value);
          resetSensorTimeout();
        }
      }
    },
    [resetSensorTimeout],
  );

  const handleDisconnect = useCallback(() => {
    if (sensorTimeoutRef.current) clearTimeout(sensorTimeoutRef.current);
    setConnectionState("disconnected");
    setSensorState("waiting");
    setBpm(null);
    setDeviceName(null);
    bufferRef.current = "";
    toast.error("Bluetooth device disconnected");
  }, []);

  const disconnect = useCallback(() => {
    if (characteristicRef.current) {
      try {
        characteristicRef.current.stopNotifications();
      } catch (_) {
        /* ignore */
      }
    }
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }
    handleDisconnect();
    toast.success("Disconnected");
  }, [handleDisconnect]);

  const connect = useCallback(async () => {
    if (!isWebBluetoothSupported) return;

    setConnectionState("connecting");
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [NUS_SERVICE],
      });

      device.addEventListener("gattserverdisconnected", handleDisconnect);
      deviceRef.current = device;
      setDeviceName(device.name ?? "Arduino Module");

      const server = await device.gatt!.connect();

      let rxChar: BluetoothRemoteGATTCharacteristic | null = null;
      try {
        const service = await server.getPrimaryService(NUS_SERVICE);
        rxChar = await service.getCharacteristic(NUS_RX_CHAR);
      } catch (_) {
        // NUS not available — try raw serial-like approach with any notify char
        toast.info(
          "NUS service not found — looking for any notification characteristic",
        );
      }

      if (rxChar) {
        characteristicRef.current = rxChar;
        await rxChar.startNotifications();
        rxChar.addEventListener("characteristicvaluechanged", (event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          const decoder = new TextDecoder();
          const text = decoder.decode(target.value!);
          parseBpm(text);
        });
        setConnectionState("connected");
        setSensorState("waiting");
        toast.success(`Connected to ${device.name ?? "Arduino Module"}`);
      } else {
        device.gatt!.disconnect();
        setConnectionState("disconnected");
        toast.error(
          "Could not find the pulse data characteristic. Check your Arduino firmware.",
        );
      }
    } catch (err: any) {
      setConnectionState("disconnected");
      if (err?.name !== "NotFoundError") {
        toast.error(err?.message ?? "Connection failed");
      }
    }
  }, [isWebBluetoothSupported, handleDisconnect, parseBpm]);

  useEffect(() => {
    return () => {
      if (sensorTimeoutRef.current) clearTimeout(sensorTimeoutRef.current);
    };
  }, []);

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";
  const isSensorActive =
    isConnected && sensorState === "connected" && bpm !== null;

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(oklch(0.22 0.015 260 / 0.3) 1px, transparent 1px), linear-gradient(90deg, oklch(0.22 0.015 260 / 0.3) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      {/* Radial glow background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 50%, oklch(0.62 0.22 18 / 0.05) 0%, transparent 70%)",
        }}
      />

      {/* Header */}
      <header className="relative z-10 border-b border-border/50 bg-card/40 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Activity className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="font-display font-700 text-lg tracking-tight text-foreground">
                PulseMonitor
              </h1>
              {deviceName && (
                <p className="text-xs text-muted-foreground font-mono">
                  {deviceName}
                </p>
              )}
            </div>
          </div>

          {/* Status badges */}
          <div className="flex items-center gap-2">
            <Badge
              data-ocid="status.bluetooth_status"
              variant="outline"
              className={`text-xs font-mono px-2 py-0.5 gap-1.5 border ${
                isConnected
                  ? "border-success/50 text-success bg-success/10"
                  : "border-muted-foreground/30 text-muted-foreground"
              }`}
            >
              {isConnected ? (
                <Bluetooth className="w-3 h-3" />
              ) : (
                <BluetoothOff className="w-3 h-3" />
              )}
              {isConnected ? "Connected" : "Not Connected"}
            </Badge>

            <Badge
              data-ocid="status.sensor_status"
              variant="outline"
              className={`text-xs font-mono px-2 py-0.5 gap-1.5 border ${
                isSensorActive
                  ? "border-success/50 text-success bg-success/10"
                  : "border-muted-foreground/30 text-muted-foreground"
              }`}
            >
              {isSensorActive ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              Sensor: {isSensorActive ? "Connected" : "Not Connected"}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12">
        <AnimatePresence mode="wait">
          {/* Web Bluetooth not supported */}
          {!isWebBluetoothSupported && (
            <motion.div
              key="no-bluetooth"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center max-w-md"
              data-ocid="display.error_state"
            >
              <div className="w-20 h-20 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center mx-auto mb-6">
                <AlertCircle className="w-10 h-10 text-destructive" />
              </div>
              <h2 className="font-display font-700 text-2xl text-foreground mb-3">
                Browser Not Supported
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Web Bluetooth is not supported in this browser. Please use{" "}
                <span className="text-foreground font-medium">
                  Chrome on Android
                </span>{" "}
                or{" "}
                <span className="text-foreground font-medium">
                  Chrome on desktop
                </span>
                .
              </p>
            </motion.div>
          )}

          {/* Disconnected state */}
          {isWebBluetoothSupported && !isConnected && !isConnecting && (
            <motion.div
              key="disconnected"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center"
            >
              <div className="relative w-32 h-32 mx-auto mb-8">
                <div className="absolute inset-0 rounded-full bg-muted/30 border border-border" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <BluetoothOff className="w-12 h-12 text-muted-foreground" />
                </div>
              </div>
              <h2 className="font-display font-700 text-3xl text-foreground mb-3">
                Connect to Bluetooth Module
              </h2>
              <p className="text-muted-foreground mb-10 max-w-sm mx-auto">
                Pair with your Arduino HC-05 / HC-06 to start monitoring pulse
                rate in real time.
              </p>
              <Button
                data-ocid="bluetooth.connect_button"
                size="lg"
                onClick={connect}
                className="bg-primary/90 hover:bg-primary text-primary-foreground px-10 py-4 text-lg font-display font-600 rounded-full shadow-glow transition-all duration-200 hover:shadow-glow-lg"
              >
                <Bluetooth className="w-5 h-5 mr-2" />
                Connect Bluetooth
              </Button>
            </motion.div>
          )}

          {/* Connecting state */}
          {isConnecting && (
            <motion.div
              key="connecting"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center"
              data-ocid="display.loading_state"
            >
              <div className="relative w-32 h-32 mx-auto mb-8">
                <div className="absolute inset-0 rounded-full border border-primary/30 animate-ping" />
                <div className="absolute inset-2 rounded-full border border-primary/50 animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Bluetooth className="w-12 h-12 text-primary" />
                </div>
              </div>
              <h2 className="font-display font-700 text-2xl text-foreground mb-2">
                Connecting...
              </h2>
              <p className="text-muted-foreground">
                Select your Arduino Bluetooth module
              </p>
            </motion.div>
          )}

          {/* Connected — waiting for sensor */}
          {isConnected && sensorState === "waiting" && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center"
              data-ocid="display.loading_state"
            >
              <div className="relative w-32 h-32 mx-auto mb-8">
                <div className="absolute inset-0 rounded-full border border-primary/20 animate-ping" />
                <div className="absolute inset-4 rounded-full border border-primary/40 animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Heart className="w-12 h-12 text-primary/60" />
                </div>
              </div>
              <h2 className="font-display font-700 text-2xl text-foreground mb-2">
                Waiting for sensor data...
              </h2>
              <p className="text-muted-foreground">
                Place finger on the pulse sensor
              </p>
            </motion.div>
          )}

          {/* Connected — sensor not sending (timeout) */}
          {isConnected && sensorState === "disconnected" && (
            <motion.div
              key="no-sensor"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center"
              data-ocid="display.error_state"
            >
              <div className="relative w-32 h-32 mx-auto mb-8">
                <div className="absolute inset-0 rounded-full bg-destructive/10 border border-destructive/30" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Heart className="w-12 h-12 text-destructive/60" />
                </div>
              </div>
              <h2 className="font-display font-700 text-3xl text-foreground mb-3">
                Pulse Sensor Not Connected
              </h2>
              <p className="text-muted-foreground max-w-sm mx-auto">
                No valid BPM data received. Check your pulse sensor wiring and
                place your finger firmly on the sensor.
              </p>
            </motion.div>
          )}

          {/* Active BPM display */}
          {isSensorActive && bpm !== null && (
            <motion.div
              key="active"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center"
              data-ocid="display.bpm_panel"
            >
              {/* Pulse rings */}
              <div className="relative w-56 h-56 mx-auto mb-8 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-primary/20 pulse-ring" />
                <div className="absolute inset-0 rounded-full border border-primary/15 pulse-ring-2" />
                <div
                  className="absolute inset-8 rounded-full bg-primary/5 border border-primary/20"
                  style={{ boxShadow: "0 0 40px oklch(0.62 0.22 18 / 0.2)" }}
                />
                {/* Heart icon */}
                <div className="relative z-10 flex flex-col items-center">
                  <Heart
                    className="w-10 h-10 text-primary mb-2 heartbeat-icon"
                    fill="currentColor"
                  />
                </div>
              </div>

              {/* BPM number */}
              <motion.div
                key={bpm}
                initial={{ scale: 0.85, opacity: 0.5 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
              >
                <div
                  className="font-mono font-700 text-foreground leading-none bpm-glow"
                  style={{ fontSize: "clamp(80px, 18vw, 140px)" }}
                >
                  {bpm}
                </div>
                <div className="font-display font-600 text-2xl text-muted-foreground tracking-widest uppercase mt-1">
                  BPM
                </div>
              </motion.div>

              {/* BPM range indicator */}
              <div className="mt-6 flex items-center justify-center gap-3">
                <div
                  className={`text-xs font-mono px-3 py-1 rounded-full border ${
                    bpm < 60
                      ? "text-blue-400 border-blue-400/30 bg-blue-400/10"
                      : bpm <= 100
                        ? "text-success border-success/30 bg-success/10"
                        : "text-orange-400 border-orange-400/30 bg-orange-400/10"
                  }`}
                >
                  {bpm < 60
                    ? "Below Normal"
                    : bpm <= 100
                      ? "Normal Range"
                      : "Elevated"}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Disconnect button */}
        <AnimatePresence>
          {isConnected && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="mt-12"
            >
              <Button
                data-ocid="bluetooth.secondary_button"
                variant="outline"
                size="lg"
                onClick={disconnect}
                className="px-8 py-3 font-display font-500 border-border/60 text-muted-foreground hover:text-foreground hover:border-destructive/50 hover:bg-destructive/5 transition-all duration-200 rounded-full"
              >
                <BluetoothOff className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/30 py-4 text-center">
        <p className="text-xs text-muted-foreground/60">
          © {new Date().getFullYear()}. Built with ♥ using{" "}
          <a
            href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-muted-foreground transition-colors"
          >
            caffeine.ai
          </a>
        </p>
      </footer>

      <Toaster position="top-right" richColors />
    </div>
  );
}
