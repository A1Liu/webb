import { Peer, PeerErrorType } from "peerjs";
import { v4 as uuid } from "uuid";
import { DataConnection } from "peerjs";
import {
  Future,
  getOrCompute,
  memoize,
  timeout,
  UnwrappedPromise,
} from "../util";
import { Channel } from "../channel";

// TODO: Figure out what to do here long term. For now, this is the shit implementation.
//
// Ideally, this should be run via QUIC on IPv6 with self-signed certificates
// tied directly to device+user IDs. For now... I guess this is fine.

// make new peerjs peer+conn frequently

const getPeerjsCode = memoize(() => import("peerjs"));

export interface PeerData {
  id: string;
}

export interface ChunkListenAddr {
  peerId?: string;
  channel: string;
}

interface ChunkMailbox {
  peerId?: string;
  channel: string;
  suffix?: string;
}

// Doesn't work for `Map` type
export interface Chunk {
  peerId: string;
  channel: string;
  ignorePeerIdForChannel?: boolean;
  data: unknown;
}

interface ChunkData {
  peerId: string;
  channel: string;
  suffix?: string;
  ignorePeerIdForChannel?: boolean;
  __rpc_id?: string;
  __end_rpc_list?: boolean;
  data: unknown;
}

export type NetworkUpdate =
  | {
      type: "networkStatus";
      status: "disconnected" | "connecting" | "connected";
    }
  | {
      type: "networkError";
      errorType: `${PeerErrorType}`;
    }
  | { type: "peerConnected"; peer: PeerData }
  | { type: "connInfo"; event: string; msg: string }
  | { type: "peerDisconnected"; peerId: string };

const RPC_ENDPOINT = "rpcCallEndpoint";
const RPC_CALL_CLIENT = "rpcCallClient";

function getChannel({ peerId = "", channel, suffix }: ChunkMailbox) {
  return `${peerId}\0${channel}${suffix ? `\0${suffix}` : ""}`;
}

export class NetworkLayer {
  readonly statusChannel = new Channel<NetworkUpdate>(Infinity);
  private readonly channels = new Map<string, Channel<ChunkData>>();
  private readonly inboundPeerChannel = new Channel<PeerData>(Infinity);
  private readonly connections = new Map<string, PeerConnection>();

  constructor(readonly id: string) {}

  static getPeer(network: NetworkLayer): UnwrappedPromise<Peer> {
    network.statusChannel.send({ type: "networkStatus", status: "connecting" });
    const fut = new Future<Peer>();

    getPeerjsCode().then((peerjs) => {
      const peer = new peerjs.Peer(network.id, { debug: 2 });

      peer.on("open", () => {
        network.statusChannel.send({
          type: "networkStatus",
          status: "connected",
        });

        fut.resolve(peer);

        peer.on("connection", (conn) => {
          conn.on("open", () => {
            network.inboundPeerChannel.send({ id: conn.peer });
            network.statusChannel.send({
              type: "peerConnected",
              peer: { id: conn.peer },
            });

            network.addDataChannel(conn);

            // Ensure that the peer connection is added to the channel
            network.getPeer(conn.peer);
          });
        });
      });
      peer.on("error", (e) => {
        network.statusChannel.send({ type: "networkError", errorType: e.type });
      });
      peer.on("disconnected", () => {
        network.statusChannel.send({
          type: "networkStatus",
          status: "disconnected",
        });
        network.reset();
      });
      peer.on("close", () => {
        network.statusChannel.send({
          type: "networkStatus",
          status: "disconnected",
        });
        network.reset();
      });
    });

    return fut.unwrapped;
  }

  private getPeer(peerId: string): PeerConnection {
    return getOrCompute(this.connections, peerId, () => {
      return new PeerConnection(peerId, new Set());
    });
  }

  private addDataChannel(conn: DataConnection) {
    const peerId = conn.peer;
    const peerConn = this.getPeer(peerId);

    if (peerConn.dataChannels.has(conn)) return;
    peerConn.dataChannels.add(conn);

    conn.on("data", (dataIn) => {
      // TODO: fix the cast later
      const chunk = dataIn as any as ChunkData;

      const key = getChannel({
        channel: chunk.channel,
        peerId: chunk.ignorePeerIdForChannel ? undefined : peerId,
        suffix: chunk.suffix,
      });

      const channel = getOrCompute(
        this.channels,
        key,
        () => new Channel(Infinity),
      );

      channel.send({ ...chunk, peerId });
    });
    conn.on("error", (evt) => {
      this.statusChannel.send({
        type: "connInfo",
        event: "error",
        msg: evt.type,
      });
      conn.close();
    });
    conn.on("close", () => {
      this.statusChannel.send({ type: "peerDisconnected", peerId });

      this.getPeer(peerId).dataChannels.delete(conn);
      this.reset();
    });
    conn.on("iceStateChanged", (evt) => {
      this.statusChannel.send({
        type: "connInfo",
        event: "iceStateChanged",
        msg: evt,
      });
      if (evt === "disconnected") {
        conn.close();
      }
    });
  }

  private async getDataChannel(peerId: string): Promise<DataConnection> {
    const channels = this.getPeer(peerId).dataChannels;
    if (channels) {
      for (const channel of channels) {
        return channel;
      }
    }

    const fut = new Future<DataConnection>();
    const peerFut = this._peerGetter();
    const peer = peerFut.value ?? (await peerFut.promise);
    const conn = peer.connect(peerId, { serialization: "binary" });
    conn.on("open", () => {
      this.statusChannel.send({ type: "peerConnected", peer: { id: peerId } });

      this.addDataChannel(conn);
      fut.resolve(conn);
    });

    return await fut.promise;
  }

  private readonly _peerGetter = memoize(() => {
    return NetworkLayer.getPeer(this);
  });

  ensureInit() {
    this._peerGetter();
  }

  reset() {
    const peer = this._peerGetter.memoizedValue?.value;
    if (peer && !peer.destroyed) {
      peer.destroy();
    }

    this._peerGetter.clear();

    // We should always re-connect ASAP so that subsequent messages don't get
    // dropped. However, we don't want to connect immediately, because other
    // event handlers might still need to fire (and they'll call this method).
    //
    // This timeout prevents errors from causing an infinite loop when e.g.
    // a peer disconnects.
    timeout(1000).then(() => this._peerGetter());
  }

  async listen(): Promise<PeerData> {
    this._peerGetter();
    return this.inboundPeerChannel.pop();
  }

  async recv(chunkId: ChunkListenAddr): Promise<Chunk> {
    const key = getChannel(chunkId);
    const channel = getOrCompute(
      this.channels,
      key,
      () => new Channel(Infinity),
    );

    return await channel.pop();
  }

  private async sendDataRaw(peerId: string, chunk: ChunkData) {
    const channel = await this.getDataChannel(peerId);
    await channel.send(chunk);
  }

  async sendData(chunk: Chunk) {
    this.sendDataRaw(chunk.peerId, chunk);
  }

  async *rpcCall(
    chunk: Omit<Chunk, "ignorePeerIdForChannel">,
  ): AsyncGenerator<Chunk> {
    const id = uuid();
    {
      await this.sendDataRaw(chunk.peerId, {
        ...chunk,
        suffix: RPC_ENDPOINT,
        __rpc_id: id,
        ignorePeerIdForChannel: true,
      });
    }

    const key = getChannel({
      peerId: chunk.peerId,
      channel: chunk.channel,
      suffix: RPC_CALL_CLIENT + id,
    });
    const channel = getOrCompute(
      this.channels,
      key,
      () => new Channel(Infinity),
    );

    while (true) {
      const chunk = await channel.pop();
      if (chunk.__end_rpc_list) break;

      yield chunk;
    }
  }

  async rpcSingleExec(
    channel: string,
    rpc: (data: Chunk) => AsyncGenerator<unknown>,
  ): Promise<void> {
    const key = getChannel({ channel, suffix: RPC_ENDPOINT });

    const inputChannel = getOrCompute(
      this.channels,
      key,
      () => new Channel(Infinity),
    );

    const request = await inputChannel.pop();
    const id = request.__rpc_id;
    if (!id) {
      console.error(
        "RPC request didn't contain RPC id",
        JSON.stringify(request),
      );
      return;
    }

    for await (const resp of rpc(request)) {
      await this.sendDataRaw(request.peerId, {
        peerId: request.peerId,
        channel,
        suffix: RPC_CALL_CLIENT + id,
        __rpc_id: id,
        data: resp,
      });
    }

    await this.sendDataRaw(request.peerId, {
      peerId: request.peerId,
      channel,
      suffix: RPC_CALL_CLIENT + id,
      __rpc_id: id,
      __end_rpc_list: true,
      data: {},
    });
  }
}

export class PeerConnection {
  constructor(
    readonly id: string,
    readonly dataChannels: Set<DataConnection>,
  ) {}
}
