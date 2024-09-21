import {
  ConnectionDriver,
  ConnectionDriverDefinition,
  ConnectionDriverInit,
  ConnectionRegisterInfo,
  RawDatagram,
  NetworkContext,
} from "@a1liu/webb-tools/network";
import {
  Future,
  getOrCompute,
  memoize,
  UnwrappedPromise,
} from "@a1liu/webb-tools/util";
import { DataConnection, Peer } from "peerjs";

// TODO: Figure out what to do here long term. For now, this is the shit implementation.
//
// Ideally, this should be run via QUIC on IPv6 with self-signed certificates
// tied directly to device+user IDs. For now... I guess this is fine.

// make new peerjs peer+conn frequently

const getPeerjsCode = memoize(() => import("peerjs"));

export class PeerConnection {
  constructor(
    readonly id: string,
    readonly dataChannels: Set<DataConnection>,
  ) {}
}

export class PeerjsDriver implements ConnectionDriver {
  static readonly id = "PeerjsDriver";

  private readonly connections = new Map<string, PeerConnection>();

  private readonly deviceId: string;
  private readonly receiveDatagram: (datagram: RawDatagram) => void;
  private readonly statusChannel: ConnectionDriverInit["statusChannel"];

  constructor(fields: ConnectionDriverInit) {
    this.deviceId = fields.deviceInfo.deviceId;
    this.receiveDatagram = fields.receiveDatagram;
    this.statusChannel = fields.statusChannel;

    console.log("creating", fields);
  }

  static getPeer(network: PeerjsDriver): UnwrappedPromise<Peer> {
    const fut = new Future<Peer>();

    getPeerjsCode().then((peerjs) => {
      const peer = new peerjs.Peer(network.deviceId, { debug: 2 });

      peer.on("open", () => {
        network.statusChannel.send({
          type: "networkStatus",
          status: "connected",
        });

        fut.resolve(peer);

        peer.on("connection", (conn) => {
          conn.on("open", () => {
            network.statusChannel.send({
              type: "peerConnected",
              peer: { deviceId: conn.peer },
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

  private addDataChannel(conn: DataConnection) {
    const peerId = conn.peer;
    const peerConn = this.getPeer(peerId);

    if (peerConn.dataChannels.has(conn)) return;
    peerConn.dataChannels.add(conn);

    conn.on("data", (dataIn) => {
      // TODO: fix the cast later
      const chunk = dataIn as any as RawDatagram;

      this.receiveDatagram({ ...chunk });
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

  private getPeer(peerId: string): PeerConnection {
    return getOrCompute(this.connections, peerId, () => {
      return new PeerConnection(peerId, new Set());
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
      this.statusChannel.send({ type: "peerConnected", peer: { deviceId: peerId } });

      this.addDataChannel(conn);
      fut.resolve(conn);
    });

    return await fut.promise;
  }

  private readonly _peerGetter = memoize(() => {
    return PeerjsDriver.getPeer(this);
  });

  ensureInit() {
    console.log("ensuring init");
    this._peerGetter();
  }

  reset() {
    const peer = this._peerGetter.memoizedValue?.value;
    if (peer && !peer.destroyed) {
      peer.destroy();
    }

    this._peerGetter.clear();

    // TODO: figure this out
    //
    // Notes:
    // We should always re-connect ASAP so that subsequent messages don't get
    // dropped. However, we don't want to connect immediately, because other
    // event handlers might still need to fire (and they'll call this method).
    //
    // This timeout prevents errors from causing an infinite loop when e.g.
    // a peer disconnects.
    // timeout(1000).then(() => this._peerGetter());
  }

  registerConnection({
    peerDeviceId,
    additionalInfo,
  }: ConnectionRegisterInfo): Promise<{ success: boolean }> {
    console.log("registering ", peerDeviceId, additionalInfo);
    throw new Error("Method not implemented.");
  }

  async sendDatagram(
    datagram: RawDatagram,
    _ctx?: NetworkContext,
  ): Promise<void> {
    const channel = await this.getDataChannel(datagram.receiver);
    await channel.send(datagram);
  }

  async close(): Promise<void> {
    this.reset();
  }
}

PeerjsDriver satisfies ConnectionDriverDefinition;
