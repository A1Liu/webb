import {
  stringify as stringifyUuid,
  parse as parseUuid,
  NIL as uuidNIL,
} from "uuid";
import { Peer } from "peerjs";
import type { DataConnection } from "peerjs";
import { assertUnreachable, memoize } from "./util";

// Implements QUIC-style multiplexing over Peerjs/WebRTC

class Channel<T> {
  private readonly listeners: ((t: T) => unknown)[] = [];
  private readonly queue: T[] = [];

  constructor() {}

  push(t: T) {
    const listener = this.listeners.shift();
    if (listener) {
      listener(t);
      return;
    }

    this.queue.push(t);
  }

  async pop(): Promise<T> {
    if (this.queue.length > 0) {
      // Need to do it this way because the `T` type could allow `undefined`
      // as a value type. shifting first and checking the output would potentially
      // cause those values to disappear.
      return this.queue.shift()!;
    }

    return new Promise((res) => {
      this.listeners.push(res);
    });
  }
}

export class NetworkLayer {
  readonly inboundConnectionChannel = new Channel<PeerConnection>();

  private readonly _peerGetter = memoize<Promise<Peer>>(async () => {
    const peerjs = await import("peerjs");
    const peer = new peerjs.Peer(this.id, { debug: 2 });

    return new Promise<Peer>((res) => {
      peer.on("open", () => {
        console.log("peer opened");

        res(peer);

        peer.on("connection", (conn) => {
          conn.on("open", () => {
            console.log("conn");
            const peerConn = new PeerConnection(conn);
            this.inboundConnectionChannel.push(peerConn);
          });
        });
      });
    });
  });

  constructor(readonly id: string) {}

  private get peer(): Promise<Peer> {
    return this._peerGetter();
  }

  async listen(): Promise<PeerConnection> {
    this.peer;
    return this.inboundConnectionChannel.pop();
  }

  async connect(peerId: string): Promise<PeerConnection> {
    const peer = await this.peer;

    console.log("try connect");

    const conn = peer.connect(peerId, { serialization: "raw" });

    return new Promise((res) => {
      conn.on("open", () => {
        console.log("conn");
        res(new PeerConnection(conn));
      });
    });
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
  readonly unackedOutboundChunks = new Map<string, ArrayBuffer>();

  // Un-acked chunks which have significance to the protocol itself (e.g. Ack chunks)
  // Keys are the whole header (not just the channel ID)
  readonly unackedProtocolOutboundChunks = new Map<string, ArrayBuffer>();

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
    const header = new ChunkHeader(chunk);
    const packet = new Uint8Array(chunk, 32);

    const kind = header.chunkType;
    switch (kind) {
      case ChunkType.Ack: {
        console.log("recv ack");
        this._handleInboundAck(header, packet);
        break;
      }

      case ChunkType.Contents:
      case ChunkType.ContentsEnd:
      case ChunkType.Unknown: {
        console.log("recv contents");

        const key = header.stringKey();
        this._pushAck(key);
        console.log({ header, packet });
        break;
      }

      default:
        assertUnreachable(kind);
    }
  }

  _handleInboundAck(header: ChunkHeader, packet: Uint8Array) {
    if (packet.length % 32 !== 0) {
      console.log(
        `packet length wasn't divisble by header size 32: size=${packet.length}`,
      );
      return;
    }

    let offset = 0;
    let isAckAck = true;
    while (offset < packet.length) {
      const headerBytes = packet.subarray(offset, offset + 32);
      const header = new ChunkHeader(headerBytes);

      const key = header.stringKey();
      if (this.unackedOutboundChunks.delete(key)) {
        isAckAck = false;
      } else if (this.unackedProtocolOutboundChunks.delete(key)) {
      } else {
        console.log(
          "received ack for packet header that we don't recognize",
          key,
        );
      }

      offset += 32;
    }

    console.log("  ack processed:", { isAckAck });
    if (!isAckAck) {
      const key = header.stringKey();
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

    const arrayLength = acks.length * 32 + 32;
    const chunk = new Uint8Array(arrayLength);

    ChunkHeader.writeHeaderToChunk(
      {
        uuid: uuidNIL,
        chunkType: ChunkType.Ack,

        // TODO: these fields
        checksum: 0,
        chunkIndex: 0,
      },
      chunk,
    );

    let isAckAck = true;
    for (let index = 0; index < acks.length; index++) {
      const ack = acks[index];
      const offset = index * 32 + 32;

      const slice = chunk.subarray(offset, offset + 32);
      decodeAndWriteStringHeader(ack, slice);
      if (new ChunkHeader(slice).chunkType !== ChunkType.Ack) isAckAck = false;
    }

    const key = stringEncodeHeader(chunk.subarray(0, 32));
    console.log("sending acks", { isAckAck, key });

    if (!isAckAck) {
      this.unackedProtocolOutboundChunks.set(key, chunk);
    }

    this.connection.send(chunk);
  }

  _sendRawPacket(chunk: ArrayBuffer) {
    const packet = new Uint8Array(chunk.byteLength + 32);
    ChunkHeader.writeHeaderToChunk(
      {
        uuid: uuidNIL,
        chunkType: ChunkType.Contents,

        // TODO
        checksum: 0,
        chunkIndex: 0,
      },
      packet,
    );
    packet.set(new Uint8Array(chunk), 32);

    this.unackedOutboundChunks.set(
      stringEncodeHeader(packet.subarray(0, 32)),
      packet,
    );

    this.connection.send(packet);
  }

  close() {
    this._isClosed = true;
    this.connection.close();
  }
}

enum ChunkType {
  Unknown = "Unknown",

  Contents = "Contents",
  ContentsEnd = "ContentsEnd",
  Ack = "Ack",

  // TODO: handle drops
  // DroppedAck,
}

// 32 byte headers:
// 4 byte checksum of entire remainder of the chunk, excluding the checksum itself
// 4 byte flags encodes:
// - First byte: Type of packet
//    - 0x00 - Intentionally unused
//    - 0x01 - Content chunk
//    - 0x02 - Content chunk end
//    - 0x03 - Ack chunk
//    - 0x04 - Dropped Ack chunk (there's no listener on the other side)
// - Remaining flag bytes: undefined
// 4 byte chunk index for this side of the channel
// 4 byte chunk length
// 16 byte channel uuid
export class ChunkHeader {
  private readonly rawBytes: Uint8Array;

  constructor(_header: string | Uint8Array | ArrayBuffer) {
    this.rawBytes = ChunkHeader.narrowHeader(_header);
  }

  static narrowHeader(header: string | Uint8Array | ArrayBuffer): Uint8Array {
    if (typeof header === "string") {
      const array = new Uint8Array(32);
      decodeAndWriteStringHeader(header, array);
      return array;
    }

    if (header instanceof ArrayBuffer) {
      return new Uint8Array(header, 0, 32);
    }

    return header;
  }

  get uuid(): string {
    return stringifyUuid(this.rawBytes.subarray(16, 32));
  }

  get chunkType(): ChunkType {
    switch (this.rawBytes[4]) {
      case 1:
        return ChunkType.Contents;
      case 2:
        return ChunkType.ContentsEnd;
      case 3:
        return ChunkType.Ack;

      case 0:
      default:
        return ChunkType.Unknown;
    }
  }

  get checksum(): number {
    let sum = 0;
    for (const rawByte of this.rawBytes.subarray(0, 4)) {
      sum += rawByte;
      sum *= 256;
    }

    return sum;
  }

  get chunkIndex(): number {
    let sum = 0;
    for (const rawByte of this.rawBytes.subarray(8, 12)) {
      sum += rawByte;
      sum *= 256;
    }

    return sum;
  }

  stringKey() {
    return stringEncodeHeader(this.rawBytes);
  }

  static writeHeaderToChunk(
    header: Omit<ChunkHeader, "stringKey">,
    chunk: Uint8Array,
  ) {
    let checksum = header.checksum;
    for (let i = 0; i < 4; i++) {
      chunk[i] = checksum & 0xff;
      checksum >>= 8;
    }

    switch (header.chunkType) {
      case ChunkType.Contents:
        chunk[4] = 1;
        break;
      case ChunkType.ContentsEnd:
        chunk[4] = 2;
        break;
      case ChunkType.Ack:
        chunk[4] = 3;
        break;

      case ChunkType.Unknown:
      default:
        chunk[4] = 0xff;
        break;
    }
    chunk[5] = 0;
    chunk[6] = 0;
    chunk[7] = 0;

    let chunkIndex = header.chunkIndex;
    for (let i = 8; i < 12; i++) {
      chunk[i] = chunkIndex & 0xff;
      chunkIndex >>= 8;
    }

    chunk[12] = 0;
    chunk[13] = 0;
    chunk[14] = 0;
    chunk[15] = 0;

    const parsedHeader = parseUuid(header.uuid);
    for (let i = 0; i < 16; i++) {
      chunk[i + 16] = parsedHeader[i];
    }
  }

  toString() {
    return `ChunkHeader(uuid=${this.uuid},flags=${this.chunkType},checksum=${this.checksum})`;
  }
}

function stringEncodeHeader(header: Uint8Array): string {
  let output = "";
  for (const word of header) {
    output += word.toString(16);
  }

  return output;
}

function decodeAndWriteStringHeader(header: string, output: Uint8Array) {
  for (let offset = 0; offset < header.length; offset++) {
    output[offset] = Number.parseInt(header.substring(offset, offset + 1));
  }
}
