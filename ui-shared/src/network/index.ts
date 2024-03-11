import { NIL as uuidNIL } from "uuid";
import { Peer } from "peerjs";
import type { DataConnection } from "peerjs";
import { assertUnreachable, Channel, Future, memoize } from "../util";
import {
  Packet,
  ChunkType,
  decodeAndWriteStringHeader,
} from "./packet";

// Implements QUIC-style multiplexing over Peerjs/WebRTC

export class NetworkLayer {
  readonly inboundConnectionChannel = new Channel<PeerConnection>();

  private readonly _peerGetter = memoize(() => {
    const fut = new Future<Peer>();

    import("peerjs").then((peerjs) => {
      const peer = new peerjs.Peer(this.id, { debug: 2 });

      peer.on("open", () => {
        console.log("peer opened");

        fut.resolve(peer);

        peer.on("connection", (conn) => {
          conn.on("open", () => {
            console.log("conn");
            const peerConn = new PeerConnection(conn);
            this.inboundConnectionChannel.push(peerConn);
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
    console.log("try connect");

    const fut = new Future<PeerConnection>();
    const peer = await this._peerGetter().promise;
    const conn = peer.connect(peerId, { serialization: "raw" });
    conn.on("open", () => {
      console.log("conn");
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

export class PeerConnection {
  // Un-acked chunks, that we're holding on to in case we need to re-send them
  // Keys are the whole header (not just the channel ID)
  readonly unackedOutboundChunks = new Map<string, Packet>();

  // Un-acked chunks which have significance to the protocol itself (e.g. Ack chunks)
  // Keys are the whole header (not just the channel ID)
  readonly unackedProtocolOutboundChunks = new Map<string, Packet>();

  // Acks which we still need to send out
  readonly ackQueue: string[] = [];

  // TEMP
  readonly inboundPackets = new Channel<Uint8Array>();

  private _isClosed = false;

  inflightChunkAllowances: number = MIN_INFLIGHT_CHUNK_ALLOWANCES;

  constructor(readonly connection: DataConnection) {
    this.connection.on("data", (evt) => {
      if (!(evt instanceof ArrayBuffer)) {
        console.log(typeof evt, "wtf");
        return;
      }

      this._handleInboundChunk(evt);
    });
    this.connection.on("error", (evt) => {
      console.log("error", JSON.stringify(evt));
    });
  }

  get isClosed() {
    return this._isClosed;
  }

  async listen(): Promise<Uint8Array> {
    return this.inboundPackets.pop();
  }

  _handleInboundChunk(chunk: ArrayBuffer) {
    const packet = new Packet(chunk);

    const kind = packet.chunkType;
    switch (kind) {
      case ChunkType.Ack: {
        console.log("recv ack");
        this._handleInboundAck(packet);
        break;
      }

      case ChunkType.Contents:
      case ChunkType.ContentsEnd:
      case ChunkType.Unknown: {
        console.log("recv contents");

        const key = packet.stringKey;
        this._pushAck(key);
        console.log({ packet });
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
        isAckAck = false;
        continue;
      }

      if (this.unackedProtocolOutboundChunks.delete(key)) {
        continue;
      }

      console.log(
        "received ack for packet header that we don't recognize",
        key,
      );
    }

    console.log("  ack processed:", { isAckAck });
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
    console.log("send acks", acks);

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
    console.log("sending acks", { isAckAck, key });

    if (!isAckAck) {
      this.unackedProtocolOutboundChunks.set(key, packet);
    }

    this.connection.send(packet.rawBytes);
  }

  sendPacket(uuid: string, packetData: ArrayBuffer) {
    const packet = new Packet(packetData.byteLength);
    packet.data.set(new Uint8Array(packetData));

    packet.writeHeaderFields({
      uuid,
      chunkType: ChunkType.Contents,

      // TODO
      chunkIndex: 0,
    });

    this.unackedOutboundChunks.set(packet.stringKey, packet);

    this.connection.send(packet.rawBytes);
  }

  close() {
    this._isClosed = true;
    this.connection.close();
  }
}
