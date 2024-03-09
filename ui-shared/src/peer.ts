import {
  v4 as uuid,
  stringify as stringifyUuid,
  parse as parseUuid,
} from "uuid";
import { Peer } from "peerjs";
import type { DataConnection } from "peerjs";
import { memoize } from "./util";

export class NetworkLayer {
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
            const listener = this.connectionListeners.shift();

            if (listener) {
              listener(peerConn);
            } else {
              this.unhandledConnections.push(peerConn);
            }
          });
        });
      });
    });
  });

  private readonly connectionListeners: ((res: PeerConnection) => unknown)[] =
    [];
  private readonly unhandledConnections: PeerConnection[] = [];

  constructor(readonly id: string) {}

  private get peer(): Promise<Peer> {
    return this._peerGetter();
  }

  async listen(): Promise<PeerConnection> {
    this.peer;
    const unhandled = this.unhandledConnections.shift();
    if (unhandled) {
      return unhandled;
    }

    return new Promise<PeerConnection>((res) => {
      this.connectionListeners.push(res);
    });
  }

  async connect(peerId: string): Promise<PeerConnection> {
    const peer = await this.peer;

    console.log("try connect");

    const conn = peer.connect(peerId, {
      serialization: "raw",
    });

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
  readonly unackedOutboundChunks = new Map<string, ArrayBuffer>();

  // Un-acked chunks which have significance to the protocol itself (e.g. Ack chunks)
  // Keys are the whole header (not just the channel ID)
  readonly unackedProtocolOutboundChunks = new Map<string, ArrayBuffer>();

  // Acks which we still need to send out
  readonly ackQueue: string[] = [];

  readonly listeners = new Map<string, NetworkChannel>();

  inflightChunkAllowances: number = MIN_INFLIGHT_CHUNK_ALLOWANCES;

  constructor(readonly connection: DataConnection) {
    this.connection.on("data", (evt) => {
      if (!(evt instanceof ArrayBuffer)) {
        console.log(typeof evt, "wtf");
        return;
      }

      this._handleChunk(evt);
    });
    this.connection.on("error", (evt) => {
      console.log("error", JSON.stringify(evt));
    });
  }

  async openChannel(): Promise<NetworkChannel> {
    return this._openChannel(uuid());
  }

  private async _openChannel(uuid: string): Promise<NetworkChannel> {
    const channel = new NetworkChannel(this, uuid);

    return channel;
  }

  _handleChunk(chunk: ArrayBuffer) {
    console.log(chunk);
  }

  _sendRawChunk(chunk: ArrayBuffer) {
    this.connection.send(chunk);
  }

  close() {
    this.connection.close();
  }
}

// Serialized channel, which behaves like a TCP connection
export class NetworkChannel {
  constructor(
    readonly connection: PeerConnection,
    readonly uuid: string,
  ) {}

  _enqueueChunkReceivedFromNetwork(_chunk: ArrayBuffer) {}

  close() {}
}

enum ChunkType {
  Contents = "Contents",
  ContentsEnd = "ContentsEnd",
  Ack = "Ack",

  Unknown = "Unknown",

  // TODO: handle drops
  // DroppedAck,
}

// 32 byte headers:
// 4 byte checksum of entire remainder of the chunk, excluding the checksum itself
// 4 byte flags encodes:
// - First byte: Type of packet
//    - 0x00 - Content chunk
//    - 0x01 - Content chunk end
//    - 0x02 - Ack chunk
//    - 0x03 - Dropped Ack chunk (there's no listener on the other side)
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
    return stringifyUuid(this.rawBytes.slice(16, 32));
  }

  get flags(): ChunkType {
    switch (this.rawBytes[4]) {
      case 0:
        return ChunkType.Contents;
      case 1:
        return ChunkType.ContentsEnd;
      case 2:
        return ChunkType.Ack;

      default:
        return ChunkType.Unknown;
    }
  }

  get checksum(): number {
    let sum = 0;
    for (const rawByte of this.rawBytes.slice(0, 4)) {
      sum += rawByte;
      sum *= 256;
    }

    return sum;
  }

  get chunkIndex(): number {
    let sum = 0;
    for (const rawByte of this.rawBytes.slice(8, 12)) {
      sum += rawByte;
      sum *= 256;
    }

    return sum;
  }

  stringKey() {
    return stringEncodeHeader(this.rawBytes);
  }

  static writeHeaderToChunk(header: ChunkHeader, chunk: Uint8Array) {
    let checksum = header.checksum;
    for (let i = 0; i < 4; i++) {
      chunk[i] = checksum & 0xff;
      checksum >>= 8;
    }

    switch (header.flags) {
      case ChunkType.Contents:
        chunk[4] = 0;
        break;
      case ChunkType.ContentsEnd:
        chunk[4] = 1;
        break;
      case ChunkType.Ack:
        chunk[4] = 2;
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
    return `ChunkHeader(uuid=${this.uuid},flags=${this.flags},checksum=${this.checksum})`;
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
