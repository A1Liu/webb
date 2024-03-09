import { v4 as uuid } from "uuid";
import { DataConnection, Peer } from "peerjs";

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

// 32 byte headers:
// 4 byte checksum of entire remainder of the chunk, excluding the checksum itself
// 4 byte flags encodes:
// - First byte: Type of packet
//    - 0x00 - Content chunk
//    - 0x01 - Content chunk end
//    - 0x02 - Ack chunk
// - Remaining flag bytes: undefined
// 4 byte chunk index for this side of the channel
// 4 byte chunk length
// 16 byte channel uuid
export class NetworkLayer {
  readonly peer: Peer;

  constructor(readonly id: string) {
    this.peer = new Peer(id, { debug: 2 });
  }

  connect(peerId: string): Promise<PeerConnection> {
    const conn = this.peer.connect(peerId, {
      serialization: "raw",
    });

    return new Promise((res) => {
      conn.on("open", () => {
        res(new PeerConnection(conn));
      });
    });
  }
}

const MAX_CHUNK_LENGTH = 1 * 1024 * 1024; // 1 MB
const MIN_INFLIGHT_CHUNK_ALLOWANCES = 5;
const MAX_INFLIGHT_CHUNK_ALLOWANCES = 5;

export class PeerConnection {
  // Un-acked chunks, that we're holding on to in case we need to re-send them
  readonly unackedOutboundChunks = new Map<string, ArrayBuffer>();

  // Un-acked chunks which have significance to the protocol itself (e.g. Ack chunks)
  readonly unackedProtocolOutboundChunks = new Map<string, ArrayBuffer>();

  // Acks which we still need to send out
  readonly ackQueue: string[] = [];

  inflightChunkAllowances: number = MIN_INFLIGHT_CHUNK_ALLOWANCES;

  constructor(readonly connection: DataConnection) {
    this.connection.on("data", (evt) => {
      if (!(evt instanceof ArrayBuffer)) {
        console.log(typeof evt, "wtf");
      }
    });
    this.connection.on("error", (evt) => {});
  }

  close() {
    this.connection.close();
  }
}

class NetworkChannel {
  constructor() {}
}
