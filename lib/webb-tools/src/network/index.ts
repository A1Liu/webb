import { z } from "zod";
import { v4 as uuid } from "uuid";
import { Channel } from "./channel";
import { getOrCompute } from "../util";

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
  readonly receiveDatagram: (datagram: RawDatagram) => void;
  readonly statusChannel: Channel<NetworkUpdate>;
}

export interface ConnectionRegisterInfo {
  peerDeviceId: string;
  additionalInfo: unknown;
}

export interface ConnectionDriver {
  registerConnection(
    regInfo: ConnectionRegisterInfo,
  ): Promise<{ success: boolean }>;

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
}

export type NetworkUpdate =
  | {
      type: "networkStatus";
      status: "disconnected" | "connecting" | "connected";
    }
  | {
      type: "networkError";
      errorType: string;
    }
  | { type: "peerConnected"; peer: { deviceId: string } }
  | { type: "connInfo"; event: string; msg: string }
  | { type: "peerDisconnected"; peerId: string };

export interface RpcDefinition<In, Out> {
  name: string;
  call: (
    network: NetworkLayer,
    peerId: string,
    i: In,
  ) => AsyncGenerator<z.SafeParseReturnType<unknown, Out>>;
  singleExec: (
    network: NetworkLayer,
    run: (
      peerId: string,
      result: z.SafeParseReturnType<unknown, In>,
    ) => AsyncGenerator<Out>,
  ) => Promise<void>;
}

export class NetworkLayer {
  readonly statusChannel = new Channel<NetworkUpdate>(Infinity);
  readonly connectionDrivers = new Map<string, ConnectionDriver>();
  private readonly channels = new Map<string, Channel<RawDatagram>>();

  constructor(readonly device: Readonly<DeviceInformation>) {}

  addConnectionDefinition<T extends ConnectionDriver>(createDriver: {
    readonly id: string;
    new (dev: ConnectionDriverInit): T;
  }): T {
    const driver: T = new createDriver({
      deviceInfo: this.device,
      statusChannel: this.statusChannel,
      receiveDatagram: (datagram) => {
        // TODO: receive datagram logic goes here

        const channel = getOrCompute(
          this.channels,
          datagram.port,
          () => new Channel<RawDatagram>(Infinity),
        );
        channel.send(datagram);
      },
    });
    this.connectionDrivers.set(createDriver.id, driver);

    return driver;
  }

  async send(
    datagram: Omit<RawDatagram, "sender">,
    ctx?: NetworkContext,
  ): Promise<{ success: boolean }> {
    for (const driver of this.connectionDrivers.values()) {
      try {
        await driver.sendDatagram(
          { ...datagram, sender: this.device.deviceId },
          ctx,
        );
        return { success: true };
      } catch (e) {}
    }

    return { success: false };
  }

  async receive(port: string, _ctx?: NetworkContext): Promise<RawDatagram> {
    const channel = getOrCompute(
      this.channels,
      port,
      () => new Channel<RawDatagram>(Infinity),
    );

    return channel.pop();
  }

  async *rpcCall(
    datagram: Pick<RawDatagram, "receiver" | "port" | "data">,
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
        receiver: request.sender,
        port: `rpc:${id}`,
        requestId: id,
        data: resp as Readonly<unknown>,
      });
    }

    await this.send({
      receiver: request.sender,
      port: `rpc:${id}`,
      requestId: id,
      closeRequestId: true,
    });
  }

  static createRpc<In extends z.ZodSchema, Out extends z.ZodSchema>(args: {
    name: string;
    input: In;
    output: Out;
  }): RpcDefinition<z.infer<In>, z.infer<Out>> {
    const { name, input, output } = args;
    return {
      name,
      call: async function* (network, peerId, input) {
        const dataFetchResult = network.rpcCall({
          receiver: peerId,
          port: name,
          data: input,
        });

        for await (const chunk of dataFetchResult) {
          yield output.safeParse(chunk.data);
        }
      },
      singleExec: async function (network, run) {
        await network.rpcSingleExec(name, async function* (chunk) {
          const result = input.safeParse(chunk.data);
          yield* run(chunk.sender, result);
        });
      },
    };
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

export function createRpcDefinition() {}
