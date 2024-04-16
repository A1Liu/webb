import { Peer } from "peerjs";
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

// Doesn't work for `Map` type
export interface Chunk {
  peerId: string;
  channel: string;
  ignorePeerIdForChannel?: boolean;
  data: unknown;
}

function getChannel(chunkId: Omit<Chunk, "data">) {
  const peerId = chunkId.ignorePeerIdForChannel ? "" : chunkId.peerId;
  return `${peerId}\0${chunkId.channel}`;
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
      const chunk = (dataIn as any) as Chunk;

      const key = getChannel({ ...chunk, peerId });

      const channel = getOrCompute(
        this.channels,
        key,
        () => new Channel(Infinity)
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

  async recv(chunkId: Omit<Chunk, "data">): Promise<Chunk> {
    const key = getChannel(chunkId);
    const channel = getOrCompute(
      this.channels,
      key,
      () => new Channel(Infinity)
    );

    return await channel.pop();
  }

  async sendData(chunk: Chunk) {
    const channel = await this.getDataChannel(chunk.peerId);
    await channel.send(chunk);
  }
}

export class PeerConnection {
  constructor(
    readonly id: string,
    readonly dataChannels: Set<DataConnection>
  ) {}
}
