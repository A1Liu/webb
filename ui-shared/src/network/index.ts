import { Peer } from "peerjs";
import { DataConnection } from "peerjs";
import { Future, memoize, timeout, UnwrappedPromise } from "../util";
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

export class NetworkLayer {
  private readonly dataChannels = new Map<string, Set<DataConnection>>();

  readonly inboundPeerChannel = new Channel<PeerData>(Infinity);
  readonly connections = new Map<string, PeerConnection>();

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
    const existingPeerConn = this.connections.get(peerId);
    if (existingPeerConn) return existingPeerConn;

    const peerConn = new PeerConnection(peerId, new Channel<string>(Infinity));
    this.connections.set(peerId, peerConn);
    this.inboundPeerChannel.send({ id: peerId });

    return peerConn;
  }

  private addDataChannel(conn: DataConnection) {
    const peerId = conn.peer;
    const peerChannels = this.dataChannels.get(peerId) ?? new Set();
    this.dataChannels.set(peerId, peerChannels);

    if (peerChannels.has(conn)) return;
    peerChannels.add(conn);

    conn.on("data", (data) => {
      if (!(typeof data === "string")) {
        console.debug(data, "wtf");
        return;
      }

      this.getPeer(peerId).inboundPackets.send(data);
    });
    conn.on("error", (evt) => {
      console.error("conn error", JSON.stringify(evt));
      conn.close();
    });
    conn.on("close", () => {
      console.log("conn closed");

      const dataChannels = this.dataChannels.get(peerId);
      dataChannels?.delete(conn);

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
    const channels = this.dataChannels.get(peerId);
    if (channels) {
      for (const channel of channels) {
        return channel;
      }
    }

    const fut = new Future<DataConnection>();
    const peerFut = this._peerGetter();
    const peer = peerFut.value ?? (await peerFut.promise);
    const conn = peer.connect(peerId, { serialization: "raw" });
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

  get peer(): Promise<Peer> {
    return this._peerGetter().promise;
  }

  async listen(): Promise<PeerData> {
    this._peerGetter();
    return this.inboundPeerChannel.pop();
  }

  async recv(id: string): Promise<string> {
    const peerConn = this.getPeer(id);
    return await peerConn.inboundPackets.pop();
  }

  async sendData({ id, data }: { data: string; id: string }) {
    const channel = await this.getDataChannel(id);
    await channel.send(data);
  }

  async connect(peerId: string): Promise<PeerConnection> {
    console.debug("try connect");

    const fut = new Future<PeerConnection>();
    const peer = await this._peerGetter().promise;
    const conn = peer.connect(peerId, { serialization: "raw" });
    conn.on("open", () => {
      console.log("PeerConn started");

      this.addDataChannel(conn);
      fut.resolve(this.getPeer(peerId));
    });

    return fut.promise;
  }
}

export class PeerConnection {
  constructor(readonly id: string, readonly inboundPackets: Channel<string>) {}
}
