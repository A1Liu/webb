import { Peer, PeerErrorType } from "peerjs";
import { v4 as uuid } from "uuid";
import { DataConnection } from "peerjs";
import { Future, getOrCompute, memoize, UnwrappedPromise } from "../util";
import { Channel } from "../channel";

const getPeerjsCode = memoize(() => import("peerjs"));

// Data is sent to a peer on a certain channel
// you can attach an optional response channel ID as well

export interface SendAddress {
  peerId: string;
  channel: string;
  returnChannel?: string;
}

// Doesn't work for `Map` type
export interface Chunk {
  fromPeerId: string;
  toPeerId: string;
  channel: string;
  returnChannel?: string;
  data: unknown;
}
