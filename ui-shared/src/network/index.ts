import { Peer } from "peerjs";
import type { DataConnection } from "peerjs";
import { Future, memoize } from "../util";
import { Channel } from "../channel";

export class NetworkLayer {
  readonly inboundConnectionChannel = new Channel<PeerConnection>();

  private readonly _peerGetter = memoize(() => {
    const fut = new Future<Peer>();

    import("peerjs").then((peerjs) => {
      const peer = new peerjs.Peer(this.id, { debug: 2 });

      peer.on("open", () => {
        console.debug("peer opened");

        fut.resolve(peer);

        peer.on("connection", (conn) => {
          conn.on("open", () => {
            console.debug("aliu conn listen opened");
            const peerConn = new PeerConnection(conn);
            this.inboundConnectionChannel.send(peerConn);
          });
        });
      });
    });

    return fut.unwrapped;
  });

  constructor(readonly id: string) {}

  get peer(): Peer | undefined {
    return this._peerGetter().value;
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
      console.debug("aliu conn started");
      fut.resolve(new PeerConnection(conn));
    });

    return fut.promise;
  }
}

export class PeerConnection {
  readonly inboundPackets = new Channel<string>();

  private _isClosed = false;

  constructor(readonly connection: DataConnection) {
    this.connection.on("data", (data) => {
      if (!(typeof data === "string")) {
        console.debug(data, "wtf");
        return;
      }

      this.inboundPackets.send(data);
    });
    this.connection.on("error", (evt) => {
      console.debug("error", JSON.stringify(evt));
    });
    this.connection.on("close", () => {
      this._isClosed = true;
    });
  }

  get name() {
    return this.connection.label;
  }

  async send(data: string) {
    await this.connection.send(data);
  }

  async recv() {
    return await this.inboundPackets.pop();
  }

  get isClosed() {
    return this._isClosed;
  }

  close() {
    // Hopefully flush is OK
    this.connection.close({ flush: true });
    this._isClosed = true;
  }
}
