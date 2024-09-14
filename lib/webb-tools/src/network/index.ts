import { z } from "zod";

export interface NetworkContext {
  readonly abortSignal?: AbortSignal;
}

export type RawDatagram = z.infer<typeof RawDatagramSchema>;
export const RawDatagramSchema = z.object({
  receiver: z.string(),
  sender: z.string(),

  // Represents a data port on the receiver device. Data ports are independent
  // from each other.
  port: z.string(),

  // Represents a transient indicator, used for e.g. correlating RPC calls
  requestId: z.string(),

  // If you want to close this requestID
  closeRequestId: z.literal(true).nullish(),

  data: z.unknown().readonly().nullish(),
}).readonly();

// This is the interface that connection classes should return to represent a
// complete message. It does not dictate a wire-format.
export interface Datagram<Data = unknown> extends Omit<RawDatagram, "data"> {
  readonly data: Readonly<Data>;
}

export interface ConnectionDriverInit {
  readonly deviceInfo: Readonly<DeviceInformation>;
}

export interface ConnectionDriver {
  readonly id: string;

  registerConnection({
    peerDeviceId, additionalInfo
  }: {
    peerDeviceId: string;
    additionalInfo: unknown
  }): Promise<{ success: boolean }>;

  sendDatagram<T>(
    datagram: Datagram<T>,
    ctx?: NetworkContext,
  ): Promise<void>;
  receiveDatagram(channel: string, ctx?: NetworkContext): Promise<RawDatagram>;

  // Closes all connections and deletes all resources
  close(): Promise<void>;
}

export interface DeviceInformation {
  deviceId: string;
  devicePublicKey: CryptoKey;
  deviceSecretKey: CryptoKey;
}

export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; /* partialData?: T; */ error: E };

export class NetworkLayer {
  readonly connectionDrivers = new Map<string, ConnectionDriver>();
  constructor(readonly device: Readonly<DeviceInformation>) {}

  addConnectionDefinition(
    createDriver: (dev: ConnectionDriverInit) => ConnectionDriver,
  ) {
    const driver = createDriver({ deviceInfo: this.device });
    this.connectionDrivers.set(driver.id, driver);
  }

  async send<T>(
    datagram: Datagram<T>,
    ctx?: NetworkContext,
  ): Promise<Result<void>> {
    console.log(datagram, ctx);
    return { success: true, data: undefined };
  }

  async receive(
    port: string,
    ctx?: NetworkContext,
  ): Promise<Datagram<unknown>> {
    console.log(port, ctx);
    throw new Error();
  }

  // TODO: add "sleep"/"wake" methods, for saving battery (as opposed to cleanup)
  // Should also probably add corresponding methods for connection definitions
}

// RPC
//
// - Alice sends bob a datagram in channel e.g. "chat", request ID "my-req"
// - Bob, listening on channel "chat" for any message, receives the datagram
// - Bob sends back response with same parameters, including request ID "my-req"
// - Alice listens on channel "chat" with same request ID "my-req"

// Channel listener
//
// - Alice sends bob a datagram in channel e.g. "command", request ID "my-req"
// - Bob, listening on channel "command" for any message, receives the datagram

// Cancellation: https://developer.mozilla.org/en-US/docs/Web/API/AbortController

// Stream listener
//
// - Alice sends bob a datagram in channel e.g. "download", request ID "my-file"
// - Bob, listening on channel "download" for any message, receives the datagram
// - Alice sends bob another datagram to continue the stream, in "download" with
//   request ID "my-file"
// - Bob appends these datagrams together
// - Alice sends bob another datagram to send last bits of data and end the stream,
//   in "download" with request ID "my-file"
// - Bob appends this new datagram to the current list, and then ends that stream

// Network
//
// Network object contains:
// - connection adapters, which provide a transport layer, encryption, and
//   basic device authentication
// - Channels, which receive datagrams
