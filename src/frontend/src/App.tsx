import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bluetooth,
  BluetoothOff,
  ChevronDown,
  Heart,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type ConnectionState = "disconnected" | "connecting" | "connected";
type SensorState = "waiting" | "connected" | "disconnected";

const SENSOR_TIMEOUT_MS = 5000;
const BPM_MIN = 40;
const BPM_MAX = 220;
const ALERT_LOW = 60;
const ALERT_HIGH = 120;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2000;
const BPM_HISTORY_MAX = 30;

// Nordic UART Service UUIDs
const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX_CHAR = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // notify

// Hoist TextDecoder — created once, never re-instantiated on each BPM packet
const textDecoder = new TextDecoder();

const EXERCISES = [
  {
    name: "Jumping Jacks",
    description:
      "A full-body cardio exercise that raises your heart rate and improves circulation.",
    steps: [
      "Stand upright with your legs together and arms at your sides.",
      "Bend your knees slightly and jump, spreading your legs shoulder-width apart.",
      "At the same time, raise both arms above your head.",
      "Jump back to the starting position and repeat.",
      "Start with 2–3 sets of 20 reps at a comfortable pace.",
    ],
  },
  {
    name: "Push-ups",
    description:
      "Strengthens the chest, shoulders, and arms while gently elevating heart rate.",
    steps: [
      "Start in a high plank position with hands slightly wider than shoulder-width.",
      "Keep your body in a straight line from head to heels.",
      "Lower your chest toward the floor by bending your elbows.",
      "Push back up until your arms are fully extended.",
      "Aim for 3 sets of 10–15 reps; rest 30 seconds between sets.",
    ],
  },
  {
    name: "Squats",
    description:
      "Works the large leg muscles, boosting circulation and heart health.",
    steps: [
      "Stand with feet shoulder-width apart and toes pointing slightly outward.",
      "Keep your chest up and core engaged throughout.",
      "Lower your hips as if sitting into a chair, until thighs are parallel to the floor.",
      "Keep your knees tracking over your toes — do not let them cave inward.",
      "Press through your heels to return to standing. Do 3 sets of 15 reps.",
    ],
  },
  {
    name: "Plank",
    description:
      "Builds core stability and endurance, supporting good posture and heart function.",
    steps: [
      "Place forearms on the floor with elbows directly below shoulders.",
      "Extend your legs behind you, resting on your toes.",
      "Form a straight line from your head to your heels — do not let hips sag or rise.",
      "Breathe steadily and hold the position.",
      "Begin with 20–30 second holds; work up to 60 seconds over time.",
    ],
  },
];

// Count-up animation hook — uses rAF, no external deps
function useCountUp(target: number | null, duration = 400): number | null {
  const [displayed, setDisplayed] = useState<number | null>(target);
  const prevRef = useRef<number | null>(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setDisplayed(null);
      prevRef.current = null;
      return;
    }
    const from = prevRef.current ?? target;
    prevRef.current = target;
    if (from === target) {
      setDisplayed(target);
      return;
    }
    const startTime = performance.now();
    const diff = target - from;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progress) ** 3; // ease-out cubic
      setDisplayed(Math.round(from + diff * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return displayed;
}

// Inline spinner — no library needed
function Spinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// Lightweight CSS fade-in wrapper — zero JS animation cost
function FadeIn({
  children,
  className = "",
  "data-ocid": dataOcid,
}: {
  children: React.ReactNode;
  className?: string;
  "data-ocid"?: string;
}) {
  return (
    <div className={`animate-fade-in ${className}`} data-ocid={dataOcid}>
      {children}
    </div>
  );
}

// Accordion panel using CSS max-height transition — no JS animation loop
function AccordionPanel({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden transition-all duration-200 ease-in-out"
      style={{ maxHeight: open ? "600px" : "0px", opacity: open ? 1 : 0 }}
    >
      {children}
    </div>
  );
}

// BPM Sparkline SVG component
function BpmSparkline({ history }: { history: number[] }) {
  if (history.length < 2) return null;

  const width = 400;
  const height = 80;
  const padX = 36;
  const padY = 8;

  const minVal = Math.min(...history);
  const maxVal = Math.max(...history);
  const range = maxVal - minVal || 1;

  const toX = (i: number) =>
    padX + (i / (history.length - 1)) * (width - padX * 2);
  const toY = (v: number) =>
    padY + ((maxVal - v) / range) * (height - padY * 2);

  const points = history.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const polyPath = `M ${history.map((v, i) => `${toX(i)} ${toY(v)}`).join(" L ")}`;
  const areaPath = `${polyPath} L ${toX(history.length - 1)} ${height - padY} L ${toX(0)} ${height - padY} Z`;

  // Threshold lines — only draw if they fall within view range
  const lowY = toY(ALERT_LOW);
  const highY = toY(ALERT_HIGH);
  const showLowLine = lowY >= padY && lowY <= height - padY;
  const showHighLine = highY >= padY && highY <= height - padY;

  return (
    <div className="w-full mt-8">
      <p className="text-xs font-mono text-muted-foreground mb-2 text-center tracking-widest uppercase">
        BPM History
      </p>
      <svg
        data-ocid="display.chart_point"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: "80px" }}
        role="img"
      >
        <title>BPM history sparkline</title>
        <defs>
          <linearGradient id="bpm-area-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="oklch(0.62 0.22 18)"
              stopOpacity="0.35"
            />
            <stop
              offset="100%"
              stopColor="oklch(0.62 0.22 18)"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>

        {/* Filled area */}
        <path d={areaPath} fill="url(#bpm-area-gradient)" />

        {/* Alert threshold: 120 BPM */}
        {showHighLine && (
          <line
            x1={padX}
            y1={highY}
            x2={width - padX}
            y2={highY}
            stroke="oklch(0.7 0.18 55)"
            strokeWidth="1"
            strokeDasharray="4 3"
            opacity="0.6"
          />
        )}

        {/* Alert threshold: 60 BPM */}
        {showLowLine && (
          <line
            x1={padX}
            y1={lowY}
            x2={width - padX}
            y2={lowY}
            stroke="oklch(0.6 0.15 240)"
            strokeWidth="1"
            strokeDasharray="4 3"
            opacity="0.6"
          />
        )}

        {/* Main line */}
        <polyline
          points={points}
          fill="none"
          stroke="oklch(0.62 0.22 18)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Y-axis labels */}
        <text
          x="2"
          y={padY + 4}
          fill="oklch(0.55 0.015 260)"
          fontSize="9"
          fontFamily="JetBrains Mono, monospace"
        >
          {maxVal}
        </text>
        <text
          x="2"
          y={height - padY + 4}
          fill="oklch(0.55 0.015 260)"
          fontSize="9"
          fontFamily="JetBrains Mono, monospace"
        >
          {minVal}
        </text>
      </svg>
    </div>
  );
}

export default function App() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [sensorState, setSensorState] = useState<SensorState>("waiting");
  const [bpm, setBpm] = useState<number | null>(null);
  const [bpmHistory, setBpmHistory] = useState<number[]>([]);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null);
  const [connectShake, setConnectShake] = useState(false);
  const [scanDialogOpen, setScanDialogOpen] = useState(false);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(
    null,
  );
  const sensorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferRef = useRef<string>("");
  const lastAlertBpmRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const isWebBluetoothSupported = "bluetooth" in navigator;

  const displayBpm = useCountUp(bpm);

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
        const raw = line.replace(/^BPM:/i, "").trim();
        const value = Number.parseInt(raw, 10);
        if (!Number.isNaN(value) && value >= BPM_MIN && value <= BPM_MAX) {
          setBpm(value);
          setBpmHistory((prev) => {
            const next = [...prev, value];
            return next.length > BPM_HISTORY_MAX
              ? next.slice(next.length - BPM_HISTORY_MAX)
              : next;
          });
          resetSensorTimeout();

          const wasAbnormal =
            lastAlertBpmRef.current !== null &&
            (lastAlertBpmRef.current < ALERT_LOW ||
              lastAlertBpmRef.current > ALERT_HIGH);
          const isAbnormal = value < ALERT_LOW || value > ALERT_HIGH;
          if (isAbnormal && !wasAbnormal) {
            toast.warning("Warning: Abnormal Pulse Rate Detected", {
              duration: 6000,
              icon: <AlertTriangle className="w-4 h-4" />,
            });
            if (
              "Notification" in window &&
              Notification.permission === "granted"
            ) {
              new Notification("BP Recovery System Alert", {
                body: "Warning: Abnormal Pulse Rate Detected",
              });
            }
          }
          lastAlertBpmRef.current = value;
        }
      }
    },
    [resetSensorTimeout],
  );

  const handleDisconnect = useCallback(() => {
    if (sensorTimeoutRef.current) clearTimeout(sensorTimeoutRef.current);
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    setConnectionState("disconnected");
    setSensorState("waiting");
    setBpm(null);
    setBpmHistory([]);
    setDeviceName(null);
    bufferRef.current = "";
    lastAlertBpmRef.current = null;
    reconnectAttemptsRef.current = 0;
    toast.error("Bluetooth device disconnected");
  }, []);

  // Attempt to reconnect to a known device after disconnection
  const attemptReconnect = useCallback(
    async (device: BluetoothDevice) => {
      const attempt = reconnectAttemptsRef.current + 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        handleDisconnect();
        return;
      }
      reconnectAttemptsRef.current = attempt;
      toast.info(
        `Reconnecting... (attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS})`,
        {
          duration: 3000,
        },
      );

      reconnectTimeoutRef.current = setTimeout(async () => {
        try {
          const server = await device.gatt!.connect();
          let rxChar: BluetoothRemoteGATTCharacteristic | null = null;
          try {
            const service = await server.getPrimaryService(NUS_SERVICE);
            rxChar = await service.getCharacteristic(NUS_RX_CHAR);
          } catch (_) {
            // NUS not found
          }

          if (rxChar) {
            characteristicRef.current = rxChar;
            await rxChar.startNotifications();
            rxChar.addEventListener("characteristicvaluechanged", (event) => {
              const target = event.target as BluetoothRemoteGATTCharacteristic;
              const text = textDecoder.decode(target.value!);
              parseBpm(text);
            });
            reconnectAttemptsRef.current = 0;
            setConnectionState("connected");
            setSensorState("waiting");
            toast.success(`Reconnected to ${device.name ?? "Arduino Module"}`);
          } else {
            // Retry
            attemptReconnect(device);
          }
        } catch (_) {
          attemptReconnect(device);
        }
      }, RECONNECT_DELAY_MS);
    },
    [handleDisconnect, parseBpm],
  );

  const disconnect = useCallback(() => {
    // Cancel any pending reconnect
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS + 1;
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

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

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    setScanDialogOpen(false);
    setConnectionState("connecting");
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [NUS_SERVICE],
      });

      reconnectAttemptsRef.current = 0;

      device.addEventListener("gattserverdisconnected", () => {
        // Attempt auto-reconnect if not intentionally disconnected
        if (reconnectAttemptsRef.current <= MAX_RECONNECT_ATTEMPTS) {
          attemptReconnect(device);
        }
      });
      deviceRef.current = device;
      setDeviceName(device.name ?? "Arduino Module");

      const server = await device.gatt!.connect();

      let rxChar: BluetoothRemoteGATTCharacteristic | null = null;
      try {
        const service = await server.getPrimaryService(NUS_SERVICE);
        rxChar = await service.getCharacteristic(NUS_RX_CHAR);
      } catch (_) {
        toast.info(
          "NUS service not found — looking for any notification characteristic",
        );
      }

      if (rxChar) {
        characteristicRef.current = rxChar;
        await rxChar.startNotifications();
        rxChar.addEventListener("characteristicvaluechanged", (event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          // textDecoder is hoisted — no allocation per packet
          const text = textDecoder.decode(target.value!);
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
    } catch (err: unknown) {
      setConnectionState("disconnected");
      if ((err as { name?: string })?.name !== "NotFoundError") {
        toast.error(
          (err as { message?: string })?.message ?? "Connection failed",
        );
        setConnectShake(true);
        setTimeout(() => setConnectShake(false), 600);
      }
    }
  }, [isWebBluetoothSupported, attemptReconnect, parseBpm]);

  useEffect(() => {
    return () => {
      if (sensorTimeoutRef.current) clearTimeout(sensorTimeoutRef.current);
      if (reconnectTimeoutRef.current)
        clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";
  const isSensorActive =
    isConnected && sensorState === "connected" && bpm !== null;
  const isLowPulse = bpm !== null && bpm < ALERT_LOW;
  const isHighPulse = bpm !== null && bpm > ALERT_HIGH;
  const isAbnormalPulse = isLowPulse || isHighPulse;

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* ── Background layers ── */}
      <div className="bg-blob-crimson" aria-hidden="true" />
      <div className="bg-blob-blue" aria-hidden="true" />
      <div className="bg-grid" aria-hidden="true" />
      <div className="bg-vignette" aria-hidden="true" />

      {/* Scan & Connect Dialog */}
      <Dialog open={scanDialogOpen} onOpenChange={setScanDialogOpen}>
        <DialogContent data-ocid="scan.dialog" className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display font-700 text-foreground flex items-center gap-2">
              <Bluetooth className="w-5 h-5 text-primary" />
              Scan for Devices
            </DialogTitle>
            <DialogDescription className="text-muted-foreground leading-relaxed">
              Your browser will show a list of nearby Bluetooth devices. Select
              your{" "}
              <span className="text-foreground font-medium">HC-05 module</span>{" "}
              from the list to connect.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted/30 border border-border/50 px-4 py-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">
              Before connecting:
            </p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Make sure your Arduino is powered on</li>
              <li>HC-05 LED should be blinking (not solid)</li>
              <li>Enable Bluetooth on your device</li>
            </ul>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setScanDialogOpen(false)}
              data-ocid="scan.cancel_button"
            >
              Cancel
            </Button>
            <Button
              data-ocid="scan.primary_button"
              onClick={connect}
              className="bg-primary/90 hover:bg-primary text-primary-foreground font-display font-600"
            >
              <Bluetooth className="w-4 h-4 mr-2" />
              Start Scan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <header className="relative z-10 border-b border-border/50 bg-card/40 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-primary" />
            <div>
              <h1 className="font-display font-700 text-lg tracking-tight text-foreground">
                BP Recovery System
              </h1>
              {deviceName && (
                <p className="text-xs text-muted-foreground font-mono">
                  {deviceName}
                </p>
              )}
            </div>
          </div>

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
      <main className="relative z-10 flex-1 flex flex-col items-center px-6 py-12">
        <div className="w-full max-w-2xl flex flex-col items-center">
          {/* Web Bluetooth not supported */}
          {!isWebBluetoothSupported && (
            <FadeIn
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
            </FadeIn>
          )}

          {/* Disconnected / Connecting state */}
          {isWebBluetoothSupported && !isConnected && (
            <FadeIn className="text-center" data-ocid="display.loading_state">
              <div className="relative w-32 h-32 mx-auto mb-8">
                {isConnecting && (
                  <>
                    <div className="absolute inset-0 rounded-full border border-primary/30 animate-ping" />
                    <div className="absolute inset-2 rounded-full border border-primary/50 animate-pulse" />
                  </>
                )}
                <div
                  className={`absolute inset-0 rounded-full border transition-colors duration-300 ${
                    isConnecting
                      ? "border-primary/30 bg-primary/5"
                      : "border-border bg-muted/30"
                  } flex items-center justify-center`}
                >
                  <div className={isConnecting ? "animate-spin-slow" : ""}>
                    {isConnecting ? (
                      <Bluetooth className="w-12 h-12 text-primary" />
                    ) : (
                      <BluetoothOff className="w-12 h-12 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </div>

              <h2 className="font-display font-700 text-3xl text-foreground mb-3">
                {isConnecting ? "Connecting..." : "Connect to Bluetooth Module"}
              </h2>

              <p className="text-muted-foreground mb-10 max-w-sm mx-auto">
                {isConnecting
                  ? "Select your Arduino Bluetooth module from the list"
                  : "Pair with your Arduino HC-05 / HC-06 to start monitoring pulse rate in real time."}
              </p>

              <Button
                data-ocid="scan.open_modal_button"
                size="lg"
                onClick={() => setScanDialogOpen(true)}
                disabled={isConnecting}
                className={`bg-primary/90 hover:bg-primary text-primary-foreground px-10 py-4 text-lg font-display font-600 rounded-full shadow-glow transition-all duration-200 hover:shadow-glow-lg active:scale-95 ${
                  connectShake ? "connect-shake" : ""
                }`}
              >
                {isConnecting ? (
                  <>
                    <Spinner className="w-5 h-5 mr-2" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Bluetooth className="w-5 h-5 mr-2" />
                    Scan &amp; Connect
                  </>
                )}
              </Button>
            </FadeIn>
          )}

          {/* Connected — waiting for sensor */}
          {isConnected && sensorState === "waiting" && (
            <FadeIn className="text-center" data-ocid="display.loading_state">
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
            </FadeIn>
          )}

          {/* Connected — sensor not sending (timeout) */}
          {isConnected && sensorState === "disconnected" && (
            <FadeIn className="text-center" data-ocid="display.error_state">
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
            </FadeIn>
          )}

          {/* Active BPM display */}
          {isSensorActive && bpm !== null && (
            <FadeIn
              className="text-center w-full"
              data-ocid="display.bpm_panel"
            >
              <div className="relative w-56 h-56 mx-auto mb-8 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-primary/20 pulse-ring" />
                <div className="absolute inset-0 rounded-full border border-primary/15 pulse-ring-2" />
                <div
                  className="absolute inset-8 rounded-full bg-primary/5 border border-primary/20"
                  style={{ boxShadow: "0 0 40px oklch(0.62 0.22 18 / 0.2)" }}
                />
                <div className="relative z-10 flex flex-col items-center">
                  <Heart
                    className="w-14 h-14 text-primary mb-2 heartbeat-icon"
                    fill="currentColor"
                  />
                </div>
              </div>

              {/* BPM number — count-up via rAF */}
              <div>
                <div
                  className="font-mono font-700 text-foreground leading-none bpm-glow"
                  style={{ fontSize: "clamp(80px, 18vw, 140px)" }}
                >
                  {displayBpm}
                </div>
                <div className="font-display font-600 text-2xl text-muted-foreground tracking-widest uppercase mt-1">
                  BPM
                </div>
              </div>

              {/* BPM range indicator */}
              <div className="mt-6 flex items-center justify-center gap-3">
                <div
                  className={`text-xs font-mono px-3 py-1 rounded-full border ${
                    bpm < ALERT_LOW
                      ? "text-blue-400 border-blue-400/30 bg-blue-400/10"
                      : bpm <= 100
                        ? "text-success border-success/30 bg-success/10"
                        : "text-orange-400 border-orange-400/30 bg-orange-400/10"
                  }`}
                >
                  {bpm < ALERT_LOW
                    ? "Below Normal"
                    : bpm <= 100
                      ? "Normal Range"
                      : "Elevated"}
                </div>
              </div>

              {/* Suggestion card — CSS transition */}
              <div
                className={`mt-6 mx-auto max-w-sm rounded-xl border px-5 py-4 flex items-start gap-3 text-left transition-all duration-300 ${
                  isHighPulse
                    ? "border-orange-400/30 bg-orange-400/10 opacity-100 translate-y-0"
                    : isLowPulse
                      ? "border-blue-400/30 bg-blue-400/10 opacity-100 translate-y-0"
                      : "border-transparent opacity-0 pointer-events-none -translate-y-2"
                }`}
                data-ocid="alert.suggestion_panel"
              >
                <AlertTriangle
                  className={`w-5 h-5 mt-0.5 shrink-0 ${
                    isHighPulse ? "text-orange-400" : "text-blue-400"
                  }`}
                />
                <p
                  className={`text-sm leading-relaxed ${
                    isHighPulse ? "text-orange-300" : "text-blue-300"
                  }`}
                >
                  {isHighPulse
                    ? "Take slow deep breaths: inhale 4s, hold 4s, exhale 6s. Try a seated forward fold yoga pose to calm your heart rate."
                    : "Try light movement: walk in place for 1 minute, or do 10 gentle jumping jacks to bring your pulse up."}
                </p>
              </div>

              {/* BPM History sparkline */}
              {!isAbnormalPulse && bpmHistory.length >= 2 && (
                <BpmSparkline history={bpmHistory} />
              )}
              {isAbnormalPulse && bpmHistory.length >= 2 && (
                <BpmSparkline history={bpmHistory} />
              )}
            </FadeIn>
          )}

          {/* Disconnect button — CSS transition */}
          <div
            className={`mt-12 transition-all duration-300 ${
              isConnected
                ? "opacity-100 translate-y-0"
                : "opacity-0 pointer-events-none translate-y-4"
            }`}
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
          </div>

          {/* Heart Health Exercises Section */}
          <section
            className="w-full mt-16 animate-fade-in-up"
            data-ocid="exercises.section"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-border/50" />
              <div className="flex items-center gap-2">
                <Heart className="w-5 h-5 text-primary" />
                <h2 className="font-display font-700 text-xl text-foreground tracking-tight">
                  Heart Health Exercises
                </h2>
              </div>
              <div className="flex-1 h-px bg-border/50" />
            </div>

            <div className="space-y-3">
              {EXERCISES.map((exercise, idx) => {
                const isOpen = expandedExercise === idx;
                return (
                  <div
                    key={exercise.name}
                    className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm overflow-hidden"
                    data-ocid={`exercises.item.${idx + 1}`}
                  >
                    <button
                      type="button"
                      data-ocid={`exercises.toggle.${idx + 1}`}
                      className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/20 transition-colors"
                      onClick={() => setExpandedExercise(isOpen ? null : idx)}
                    >
                      <div>
                        <p className="font-display font-600 text-foreground">
                          {exercise.name}
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {exercise.description}
                        </p>
                      </div>
                      <div
                        className="ml-4 shrink-0 text-muted-foreground transition-transform duration-200"
                        style={{
                          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                        }}
                      >
                        <ChevronDown className="w-5 h-5" />
                      </div>
                    </button>

                    <AccordionPanel open={isOpen}>
                      <div className="px-5 pb-5 border-t border-border/30">
                        <ol className="mt-4 space-y-2">
                          {exercise.steps.map((step, stepIdx) => (
                            <li
                              key={step.slice(0, 20)}
                              className="flex items-start gap-3"
                            >
                              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono font-600 flex items-center justify-center mt-0.5">
                                {stepIdx + 1}
                              </span>
                              <p className="text-sm text-muted-foreground leading-relaxed">
                                {step}
                              </p>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </AccordionPanel>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/30 py-4 text-center mt-12">
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
