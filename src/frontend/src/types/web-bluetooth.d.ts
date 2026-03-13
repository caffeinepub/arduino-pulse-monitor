// Minimal Web Bluetooth API type declarations

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly uuid: string;
  readonly value: DataView | null;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
  addEventListener(
    type: "characteristicvaluechanged",
    listener: (event: Event) => void,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void;
}

interface BluetoothRemoteGATTService {
  readonly uuid: string;
  getCharacteristic(
    characteristic: string,
  ): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(
    characteristic?: string,
  ): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
  addEventListener(
    type: "gattserverdisconnected",
    listener: (event: Event) => void,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void;
}

interface BluetoothRequestDeviceFilter {
  services?: string[];
  name?: string;
  namePrefix?: string;
}

interface RequestDeviceOptions {
  filters?: BluetoothRequestDeviceFilter[];
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}

interface Bluetooth {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
  getAvailability(): Promise<boolean>;
}

interface Navigator {
  readonly bluetooth: Bluetooth;
}
