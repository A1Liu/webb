import { stringify as stringifyUuid, parse as parseUuid } from "uuid";

export enum ChunkType {
  Unknown = "Unknown",

  Contents = "Contents",
  ContentsEnd = "ContentsEnd",
  Ack = "Ack",

  // TODO: handle drops
  // DroppedAck,
}

const ChunkTypeToByteValue: Record<ChunkType, number> = {
  [ChunkType.Unknown]: 0xff,
  [ChunkType.Contents]: 1,
  [ChunkType.ContentsEnd]: 2,
  [ChunkType.Ack]: 3,
};

const ByteValueToChunkType: Record<number, ChunkType> = {
  [1]: ChunkType.Contents,
  [2]: ChunkType.ContentsEnd,
  [3]: ChunkType.Ack,
};

interface PacketHeader {
  uuid: string;
  chunkType: ChunkType;
  checksum: number;
  chunkIndex: number;
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
export class Packet implements PacketHeader {
  readonly rawBytes: ArrayBuffer;
  readonly header: Uint8Array;
  readonly data: Uint8Array;

  constructor(dataLength: number);
  constructor(packetBytes: Uint8Array | ArrayBuffer);
  constructor(_header: Uint8Array | ArrayBuffer | number) {
    const header =
      _header instanceof ArrayBuffer
        ? new Uint8Array(_header)
        : typeof _header === "number"
        ? new Uint8Array(_header + 32)
        : _header;

    this.header = header.subarray(0, 32);
    this.data = header.subarray(32);
    this.rawBytes = header;
  }

  get uuid(): string {
    return stringifyUuid(this.header.subarray(16, 32));
  }

  get chunkType(): ChunkType {
    const byteVal = this.header[4];
    return ByteValueToChunkType[byteVal] ?? ChunkType.Unknown;
  }

  get checksum(): number {
    let sum = 0;
    for (const rawByte of this.header.subarray(0, 4)) {
      sum += rawByte;
      sum *= 256;
    }

    return sum;
  }

  get chunkIndex(): number {
    let sum = 0;
    for (const rawByte of this.header.subarray(8, 12)) {
      sum += rawByte;
      sum *= 256;
    }

    return sum;
  }

  get stringKey() {
    return stringEncodeHeader(this.header);
  }

  writeHeaderFields(header: Omit<PacketHeader, "checksum">) {
    Packet.writeHeaderToChunk(header, this.header);
  }

  static writeHeaderToChunk(
    header: Omit<PacketHeader, "checksum">,
    chunk: Uint8Array,
  ) {
    // TODO
    // let checksum = header.checksum;
    // for (let i = 0; i < 4; i++) {
    //   chunk[i] = checksum & 0xff;
    //   checksum >>= 8;
    // }

    const chunkTypeByte =
      ChunkTypeToByteValue[header.chunkType] ??
      ChunkTypeToByteValue[ChunkType.Unknown];

    chunk[4] = chunkTypeByte;
    chunk[5] = 0;
    chunk[6] = 0;
    chunk[7] = 0;

    let chunkIndex = header.chunkIndex;
    for (let i = 8; i < 12; i++) {
      chunk[i] = chunkIndex & 0xFF;
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

  *dataAsPacketHeaders(): Generator<[number, Packet]> {
    if (this.data.length % 32 !== 0) {
      console.log(
        `packet data length wasn't divisble by header size 32: size=${this.data.length}`,
      );
      return;
    }

    const packetCount = this.data.length / 32;
    for (let index = 0; index < packetCount; index++) {
      const offset = index * 32;
      yield [index, new Packet(this.data.subarray(offset, offset + 32))];
    }
  }

  toString() {
    return `ChunkHeader(uuid=${this.uuid},flags=${this.chunkType},checksum=${this.checksum})`;
  }
}

export function stringEncodeHeader(header: Uint8Array): string {
  let output = "";
  for (const word of header) {
    output += word.toString(16);
  }

  return output;
}

export function decodeAndWriteStringHeader(header: string, output: Uint8Array) {
  for (let offset = 0; offset < header.length; offset++) {
    output[offset] = Number.parseInt(header.substring(offset, offset + 1));
  }
}
