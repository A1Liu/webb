"use client";

import clsx from "clsx";
import { useState } from "react";
import toast from "react-hot-toast";
import { z } from "zod";
import { GlobalInitGroup } from "../../components/constants";
import { registerListener, registerRpc } from "../../components/network";
import { Peer, usePeers } from "../../components/state/peers";

const Formatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
  timeStyle: "medium",
});

const DebugListener = registerListener({
  group: GlobalInitGroup,
  channel: "DebugListener",
  schema: z.string(),
  listener: async (_peerId, data) => {
    toast(`data=${data}`);
  },
});

const DebugRpc = registerRpc({
  group: GlobalInitGroup,
  name: "DebugRpc",
  input: z.string(),
  output: z.string(),
  rpc: async function* (_peerId, input) {
    toast("rpc called");
    yield* input.split(" ");
  },
});

function IncomingPeer({ peer }: { peer: Peer }) {
  const { cb } = usePeers();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 p-1 border rounded">
      <div className="flex gap-2 pl-2">
        {peer.connected ? (
          <div className="rounded-md w-2 h-2 bg-green-600 my-auto" />
        ) : (
          <div className="rounded-md w-2 h-2 bg-red-600 my-auto" />
        )}

        <button
          className="text-left text-ellipsis basis-0 grow overflow-hidden"
          onClick={() => setOpen((prev) => !prev)}
        >
          {peer.name ?? peer.id.replaceAll("-", "")}
        </button>

        <div className="flex gap-2">
          <button
            className="bg-sky-700 p-2 rounded hover:bg-sky-900"
            onClick={async () => {
              try {
                await DebugListener.send(peer.id, "hi");
              } catch (e) {
                toast.error(String(e));
              }
            }}
          >
            ping
          </button>
        </div>
      </div>

      <div className={clsx(!open && "hidden", "flex gap-2")}>
        <button
          className="bg-sky-700 p-2 rounded hover:bg-sky-900"
          onClick={() => {
            cb.deletePeer(peer.id);
          }}
        >
          delete
        </button>

        <button
          className="bg-sky-700 p-2 rounded hover:bg-sky-900"
          onClick={async () => {
            const rpcResult = DebugRpc.call(peer.id, "hello world!");
            for await (const result of rpcResult) {
              toast(result);
            }
          }}
        >
          RPC
        </button>

        {peer.lastConnected ? (
          <p className="p-2">
            Last conn: {Formatter.format(peer.lastConnected)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function IncomingPeers({ peers }: { peers: { id: string }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {peers.map((peer) => (
        <IncomingPeer key={peer.id} peer={peer} />
      ))}
    </div>
  );
}
