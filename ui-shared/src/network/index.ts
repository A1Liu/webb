import { NIL as uuidNIL } from "uuid";
import { Peer } from "peerjs";
import type { DataConnection } from "peerjs";
import { assertUnreachable, Channel, Future, memoize } from "../util";
import { Packet, ChunkType, decodeAndWriteStringHeader } from "./packet";

// Implements QUIC-style multiplexing over Peerjs/WebRTC
//
// TODO:
// - Recovery from connection breaking, IP changing
// - Recovery from restarting, etc
// - Resending dropped packets
// - Connection closing
// - Back pressure
// - Race conditions with opening connections at the same time
// - Global congestion control
// - Ensuring packet order
// - Channel scheduling, resource allocation
// - Chunking data, splitting messages into pieces and rejoining them

// Does the job of self registration and listening for/sending out connections
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
            console.debug("conn");
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
      console.debug("conn");
      fut.resolve(new PeerConnection(conn));
    });

    return fut.promise;
  }
}

// Need to stay below 16KiB limit, see docs:
// https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels#concerns_with_large_messages
// const MAX_CHUNK_LENGTH = 8 * 1024 + 32; // 8KiB + 32 bytes for the header
const MIN_INFLIGHT_CHUNK_ALLOWANCES = 8;
// const MAX_INFLIGHT_CHUNK_ALLOWANCES = 64;

// Connection between another peer
// Does job of sending data out, receiving data, congestion control?
export class PeerConnection {
  // Un-acked chunks, that we're holding on to in case we need to re-send them
  // Keys are the whole header (not just the channel ID)
  readonly unackedOutboundChunks = new Map<string, Packet>();

  // Acks which we still need to send out
  readonly ackQueue: string[] = [];

  // TEMP
  readonly inboundPackets = new Channel<Uint8Array>();

  readonly channels = new Map<string, NetworkChannel>();

  private _isClosed = false;

  inflightChunkAllowances: number = MIN_INFLIGHT_CHUNK_ALLOWANCES;

  constructor(readonly connection: DataConnection) {
    this.connection.on("data", (evt) => {
      if (!(evt instanceof ArrayBuffer)) {
        console.debug(typeof evt, "wtf");
        return;
      }

      this._handleInboundChunk(evt);
    });
    this.connection.on("error", (evt) => {
      console.debug("error", JSON.stringify(evt));
    });

    this.channels.set(uuidNIL, new NetworkChannel(uuidNIL, this));
  }

  get isClosed() {
    return this._isClosed;
  }

  get defaultChannel(): NetworkChannel {
    return this.channels.get(uuidNIL)!;
  }

  async _handleInboundChunk(chunk: ArrayBuffer) {
    const packet = new Packet(chunk);

    const kind = packet.chunkType;
    switch (kind) {
      case ChunkType.Ack: {
        console.debug("recv ack");
        this._handleInboundAck(packet);
        break;
      }

      case ChunkType.Contents:
      case ChunkType.ContentsEnd: {
        const key = packet.stringKey;
        console.debug("recv contents", { key });

        const channel = this.channels.get(packet.uuid);
        if (!channel) {
          this._pushAck(key);
          console.debug("unrecognized channel, dropping packet", { key });
          break;
        }

        await channel.receiveFromNetwork(packet);
        this._pushAck(key);
        break;
      }
      case ChunkType.Unknown: {
        const key = packet.stringKey;
        console.debug("recv unknown", { key });

        this._pushAck(key);
        break;
      }

      default:
        assertUnreachable(kind);
    }
  }

  _handleInboundAck(packet: Packet) {
    let isAckAck = true;
    for (const [, ackPacket] of packet.dataAsPacketHeaders()) {
      const key = ackPacket.stringKey;
      if (this.unackedOutboundChunks.delete(key)) {
        isAckAck = isAckAck && ackPacket.chunkType === ChunkType.Ack;
        continue;
      }

      console.debug(
        "received ack for packet header that we don't recognize",
        key,
      );
    }

    console.debug("  ack processed:", { isAckAck });
    if (!isAckAck) {
      const key = packet.stringKey;
      this._pushAck(key);
    }
  }

  _pushAck(key: string) {
    if (this.ackQueue.length === 0) {
      setTimeout(() => this._sendAcks(), 0);
    }

    this.ackQueue.push(key);
  }

  _sendAcks() {
    const acks = this.ackQueue.splice(0);
    console.debug("send acks", acks);

    const packet = new Packet(acks.length * 32);

    let isAckAck = true;
    for (const [index, ackPacket] of packet.dataAsPacketHeaders()) {
      const ack = acks[index];
      decodeAndWriteStringHeader(ack, ackPacket.header);

      if (ackPacket.chunkType !== ChunkType.Ack) isAckAck = false;
    }

    packet.writeHeaderFields({
      uuid: uuidNIL,
      chunkType: ChunkType.Ack,

      // TODO: these fields
      chunkIndex: 0,
    });

    const key = packet.stringKey;
    console.debug("sending acks", { isAckAck, key });

    if (!isAckAck) {
      this.unackedOutboundChunks.set(key, packet);
    }

    this.connection.send(packet.rawBytes);
  }

  sendPacket({
    uuid,
    chunkIndex,
    packetData,
  }: {
    uuid: string;
    chunkIndex: number;
    packetData: Uint8Array;
  }) {
    const packet = new Packet(packetData.byteLength);
    packet.data.set(packetData);

    packet.writeHeaderFields({
      uuid,
      chunkType: ChunkType.Contents,
      chunkIndex,
    });

    this.unackedOutboundChunks.set(packet.stringKey, packet);

    this.connection.send(packet.rawBytes);
  }

  close() {
    this._isClosed = true;
    this.connection.close();
  }
}

// Does TCP things i guess, except for congestion control
export class NetworkChannel extends Channel<Uint8Array> {
  outgoingChunkIndex = 0;

  constructor(
    readonly uuid: string,
    private readonly connection: PeerConnection,
  ) {
    super();
  }

  async receiveFromNetwork(packet: Packet) {
    await super.send(packet.data);
  }

  async send(packetData: Uint8Array) {
    const chunkIndex = this.outgoingChunkIndex++;
    this.connection.sendPacket({ uuid: this.uuid, chunkIndex, packetData });
  }
}
