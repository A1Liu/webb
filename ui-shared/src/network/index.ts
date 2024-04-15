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
  readonly inboundConnectionChannel = new Channel<PeerConnection>();

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
            const inbound = new Channel<string>();
            const outbound = new Channel<string>();
            const peerConn = new PeerConnection(conn.peer, {
              inbound,
              outbound,
            });
            NetworkLayer.initConnection(conn, { inbound, outbound });
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

  static initConnection(
    connection: DataConnection,
    opts: {
      inbound: Channel<string>;
      outbound: Channel<string>;
    }
  ) {
    connection.on("data", (data) => {
      if (!(typeof data === "string")) {
        console.debug(data, "wtf");
        return;
      }

      opts.inbound.send(data);
    });
    connection.on("error", (evt) => {
      console.error("conn error", JSON.stringify(evt));
    });
    connection.on("close", () => {
      console.log("conn closed");
    });
    connection.on("iceStateChanged", (evt) => {
      console.log("ice state changed", JSON.stringify(evt));
    });

    (async () => {
      while (true) {
        const data = await opts.outbound.pop();
        connection.send(data);
      }
    })();
  }

  private _peerGetter = memoize(() => {
    return NetworkLayer.getPeer(this);
  });

  constructor(readonly id: string) {}

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

      const inbound = new Channel<string>();
      const outbound = new Channel<string>();
      const peerConn = new PeerConnection(peerId, { inbound, outbound });
      NetworkLayer.initConnection(conn, { inbound, outbound });
      fut.resolve(peerConn);
    });

    return fut.promise;
  }
}

export class PeerConnection {
  private readonly inboundPackets: Channel<string>;
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
