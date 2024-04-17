import { Peer } from "peerjs";
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

export interface ChunkAddr {
  peerId: string;
  channel: string;
  ignorePeerIdForChannel?: boolean;
  __rpc_id?: string;
}

export interface ChunkListenAddr {
  peerId?: string;
  channel: string;
}

// Doesn't work for `Map` type
export interface Chunk extends ChunkAddr {
  __end_rpc_list?: boolean;
  data: unknown;
}

const RPC_ENDPOINT = "rpcCallEndpoint";
const RPC_CALL_CLIENT = "rpcCallClient";

function getChannel(chunkId: ChunkListenAddr, suffix?: string) {
  const peerId = chunkId.peerId ?? "";
  return `${peerId}\0${chunkId.channel}${suffix ? `\0${suffix}` : ""}`;
}

export class NetworkLayer {
  private readonly channels = new Map<string, Channel<Chunk>>();
  private readonly inboundPeerChannel = new Channel<PeerData>(Infinity);
  private readonly connections = new Map<string, PeerConnection>();

  constructor(readonly id: string) {}

  static getPeer(network: NetworkLayer): UnwrappedPromise<Peer> {
    console.log("getting peer");
    const fut = new Future<Peer>();

    getPeerjsCode().then((peerjs) => {
      const peer = new peerjs.Peer(network.id, { debug: 2 });

      peer.on("open", () => {
        console.log("peer opened");

        fut.resolve(peer);

        peer.on("connection", (conn) => {
          conn.on("open", () => {
            console.log("PeerConn from listen");
            network.addDataChannel(conn);

            // Ensure that the peer connection is added to the channel
            network.getPeer(conn.peer);
          });
        });
      });
      peer.on("error", (e) => {
        console.error("peer error", JSON.stringify(e));
      });
      peer.on("disconnected", () => {
        console.log("Peer disconnect");
        network.reset();
      });
      peer.on("close", () => {
        console.error("Peer close");
        network.reset();
      });
    });

    return fut.unwrapped;
  }

  private getPeer(peerId: string): PeerConnection {
    return getOrCompute(this.connections, peerId, () => {
      this.inboundPeerChannel.send({ id: peerId });
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
      const chunk = dataIn as any as Chunk;

      const key = getChannel(
        {
          channel: chunk.channel,
          peerId: chunk.ignorePeerIdForChannel ? undefined : peerId,
        },
        chunk.__rpc_id ? RPC_ENDPOINT : undefined,
      );

      const channel = getOrCompute(
        this.channels,
        key,
        () => new Channel(Infinity),
      );

      channel.send({ ...chunk, peerId });
    });
    conn.on("error", (evt) => {
      console.error("conn error", JSON.stringify(evt));
      conn.close();
    });
    conn.on("close", () => {
      console.log("conn closed");

      this.getPeer(peerId).dataChannels.delete(conn);
      this.reset();
    });
    conn.on("iceStateChanged", (evt) => {
      console.log("ice state changed", JSON.stringify(evt));
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
      console.log("PeerConn started");
      this.addDataChannel(conn);
      fut.resolve(conn);
    });

    return await fut.promise;
  }

  private readonly _peerGetter = memoize(() => {
    return NetworkLayer.getPeer(this);
  });

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

  async sendData(chunk: Chunk) {
    const channel = await this.getDataChannel(chunk.peerId);
    await channel.send(chunk);
  }

  async *rpcCall(
    chunk: Omit<Chunk, "ignorePeerIdForChannel">,
  ): AsyncGenerator<Chunk> {
    const id = uuid();
    {
      const channel = await this.getDataChannel(chunk.peerId);
      await channel.send({
        ...chunk,
        __rpc_id: id,
        ignorePeerIdForChannel: true,
      });
    }

    const key = getChannel(
      { peerId: chunk.peerId, channel: chunk.channel },
      RPC_CALL_CLIENT + id,
    );
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
    const key = getChannel({ channel }, RPC_ENDPOINT);

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

    const outputChannel = await this.getDataChannel(request.peerId);

    for await (const resp of rpc(request)) {
      await outputChannel.send({
        peerId: request.peerId,
        channel: `${channel}\0${RPC_CALL_CLIENT + id}`,
        data: resp,
      });
    }

    await outputChannel.send({
      peerId: request.peerId,
      channel: `${channel}\0${RPC_CALL_CLIENT + id}`,
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
