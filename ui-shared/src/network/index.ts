import { Peer } from "peerjs";
import type { DataConnection } from "peerjs";
import { Future, memoize, UnwrappedPromise } from "../util";
import { Channel } from "../channel";

// TODO: Figure out what to do here long term. For now, this is the shit implementation.
//
// Ideally, this should be run via QUIC on IPv6 with self-signed certificates
// tied directly to device+user IDs. For now... I guess this is fine.

// make new peerjs peer+conn frequently

const getPeerjsCode = memoize(() => import("peerjs"));

export class NetworkLayer {
  private readonly dataChannels = new Map<string, Set<DataConnection>>();

  readonly inboundConnectionChannel = new Channel<PeerConnection>();
  readonly connections = new Map<string, PeerConnection>();

  constructor(readonly id: string) {}

  static getPeer(network: NetworkLayer): UnwrappedPromise<Peer> {
    const fut = new Future<Peer>();

    getPeerjsCode().then((peerjs) => {
      const peer = new peerjs.Peer(network.id, { debug: 2 });

      peer.on("open", () => {
        console.log("peer opened");

        fut.resolve(peer);

        peer.on("connection", (conn) => {
          conn.on("open", () => {
            console.log("PeerConn from listen");
            const peerConn = network.addPeer(conn);
            network.inboundConnectionChannel.send(peerConn);
          });
        });
      });
      peer.on("error", (e) => {
        console.error("peer error", JSON.stringify(e));
      });
      peer.on("disconnected", () => {
        console.log("Peer disconnect");
      });
      peer.on("close", () => {
        console.error("Peer close");
      });
    });

    return fut.unwrapped;
  }

  private addPeer(conn: DataConnection): PeerConnection {
    const peerChannels = this.dataChannels.get(conn.peer) ?? new Set();
    this.dataChannels.set(conn.peer, peerChannels);

    peerChannels.add(conn);

    const inbound = new Channel<string>();
    const outbound = new Channel<string>();

    const peerConn =
      this.connections.get(conn.peer) ??
      new PeerConnection(conn.peer, {
        inbound,
        outbound,
      });
    this.connections.set(conn.peer, peerConn);

    conn.on("data", (data) => {
      if (!(typeof data === "string")) {
        console.debug(data, "wtf");
        return;
      }

      inbound.send(data);
    });
    conn.on("error", (evt) => {
      console.error("conn error", JSON.stringify(evt));
    });
    conn.on("close", () => {
      console.log("conn closed");
      this.dataChannels.get(conn.peer)?.delete(conn);
    });
    conn.on("iceStateChanged", (evt) => {
      console.log("ice state changed", JSON.stringify(evt));
    });

    (async () => {
      while (true) {
        const data = await outbound.pop();
        conn.send(data);
      }
    })();

    return peerConn;
  }

  private _peerGetter = memoize(() => {
    return NetworkLayer.getPeer(this);
  });

  get peer(): Promise<Peer> {
    return this._peerGetter().promise;
  }

  async listen(): Promise<PeerConnection> {
    this._peerGetter();
    return this.inboundConnectionChannel.pop();
  }

  async connect(peerId: string): Promise<PeerConnection> {
    console.debug("try connect");

    const fut = new Future<PeerConnection>();
    const peer = await this._peerGetter().promise;
    const conn = peer.connect(peerId, { serialization: "raw" });
    conn.on("open", () => {
      console.log("PeerConn started");

      const peerConn = this.addPeer(conn);
      fut.resolve(peerConn);
    });

    return fut.promise;
  }
}

export class PeerConnection {
  readonly inboundPackets: Channel<string>;
  private readonly outboundPackets: Channel<string>;

  constructor(
    readonly name: string,
    opts: {
      inbound: Channel<string>;
      outbound: Channel<string>;
    }
  ) {
    this.inboundPackets = opts.inbound;
    this.outboundPackets = opts.outbound;
  }

  async send(data: string) {
    await this.outboundPackets.send(data);
  }

  async recv() {
    return await this.inboundPackets.pop();
  }
}
