import { z } from "zod";
import { v4 as uuid } from "uuid";

export interface NetworkContext {
  readonly abortSignal?: AbortSignal;
}

export interface DriverPeerKVStore {
  getValue(peerId: string): Promise<unknown>;
  setValue(peerId: string, value: unknown): Promise<unknown>;
}

// This is the interface that connection classes should return to represent a
// complete message. It does not dictate a wire-format.
export type RawDatagram = z.infer<typeof RawDatagramSchema>;
export const RawDatagramSchema = z
  .object({
    receiver: z.string(),
    sender: z.string(),

    // Represents a data port on the receiver device. Data ports are independent
    // from each other.
    port: z.string(),

    // Represents a transient indicator, used for e.g. correlating RPC calls
    requestId: z.string(),

    // If you want to close this requestID
    closeRequestId: z.literal(true).nullish(),

    data: z.unknown().nullish(),
  })
  .readonly();

export interface ConnectionDriverInit {
  readonly deviceInfo: Readonly<DeviceInformation>;
  readonly peerKVStore: DriverPeerKVStore;
  readonly receiveDatagram: (datagram: RawDatagram) => void;
}

export interface ConnectionRegisterInfo {
  peerDeviceId: string;
  additionalInfo: unknown;
}

export interface ConnectionDriver {
  registerConnection({
    peerDeviceId,
    additionalInfo,
  }: ConnectionRegisterInfo): Promise<{ success: boolean }>;

  sendDatagram(datagram: RawDatagram, ctx?: NetworkContext): Promise<void>;

  // Closes all connections and deletes all resources
  close(): Promise<void>;
}

export interface ConnectionDriverDefinition {
  readonly id: string;
  new (dev: ConnectionDriverInit): ConnectionDriver;
}

export interface DeviceInformation {
  deviceId: string;
  devicePublicKey: CryptoKey;
  deviceSecretKey: CryptoKey;
}

export class NetworkLayer {
  readonly connectionDrivers = new Map<string, ConnectionDriver>();
  constructor(
    readonly device: Readonly<DeviceInformation>,
    readonly peerKVStore: DriverPeerKVStore,
  ) {}

  addConnectionDefinition(createDriver: ConnectionDriverDefinition) {
    const peerKVStore = this.peerKVStore;
    const driver = new createDriver({
      deviceInfo: this.device,
      peerKVStore: {
        async getValue(peerId) {
          return peerKVStore.getValue(createDriver.id + ":" + peerId);
        },
        async setValue(peerId, value) {
          return peerKVStore.setValue(createDriver.id + ":" + peerId, value);
        },
      },

      receiveDatagram: (datagram) => {
        // TODO: receive datagram logic goes here
      },
    });
    this.connectionDrivers.set(createDriver.id, driver);
  }

  async send(
    datagram: RawDatagram,
    ctx?: NetworkContext,
  ): Promise<{ success: boolean }> {
    for (const driver of this.connectionDrivers.values()) {
      try {
        await driver.sendDatagram(datagram, ctx);
        return { success: true };
      } catch (e) {}
    }

    return { success: false };
  }

  async receive(port: string, ctx?: NetworkContext): Promise<RawDatagram> {
    console.log(port, ctx);
    throw new Error();
  }

  async *rpcCall(
    datagram: Pick<RawDatagram, "receiver" | "sender" | "port" | "data">,
  ): AsyncGenerator<RawDatagram> {
    const requestId = uuid();
    await this.send({ ...datagram, requestId });

    while (true) {
      const chunk = await this.receive(`rpc:${requestId}`);
      if (chunk.closeRequestId) break;

      yield chunk;
    }
  }

  async rpcSingleExec(
    port: string,
    rpc: (data: RawDatagram) => AsyncGenerator<unknown>,
  ): Promise<void> {
    const request = await this.receive(port);
    const id = request.requestId;
    if (!id) {
      console.error(
        "RPC request didn't contain RPC id",
        JSON.stringify(request),
      );
      return;
    }

    for await (const resp of rpc(request)) {
      await this.send({
        sender: this.device.deviceId,
        receiver: request.sender,
        port: `rpc:${id}`,
        requestId: id,
        data: resp as Readonly<unknown>,
      });
    }

    await this.send({
      sender: this.device.deviceId,
      receiver: request.sender,
      port: `rpc:${id}`,
      requestId: id,
      closeRequestId: true,
    });
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
