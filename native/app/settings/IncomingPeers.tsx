import { DefaultTimeFormatter } from "@/components/util";
import clsx from "clsx";
import { useState } from "react";
import toast from "react-hot-toast";
import { z } from "zod";
import { GlobalInitGroup } from "../../components/constants";
import { registerListener, registerRpcHandler } from "../../components/network";
import { Peer, usePeers } from "../../components/state/peers";
import { NetworkLayer } from "@a1liu/webb-tools/network";

const DebugListener = registerListener({
  group: GlobalInitGroup,
  channel: "DebugListener",
  schema: z.string(),
  listener: async (_peerId, data) => {
    toast(`data=${data}`);
  },
});

const DebugRpc = registerRpcHandler({
  group: GlobalInitGroup,
  rpc: NetworkLayer.createRpc({
    name: "DebugRpc",
    input: z.string(),
    output: z.string(),
  }),
  handler: async function* (_peerId, input) {
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
          {peer.name ?? peer.deviceId.replaceAll("-", "")}
        </button>

        <div className="flex gap-2">
          <button
            className="bg-sky-700 p-2 rounded hover:bg-sky-900"
            onClick={async () => {
              try {
                await DebugListener.send(peer.deviceId, "hi");
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
            cb.deletePeer(peer.deviceId);
          }}
        >
          delete
        </button>

        <button
          className="bg-sky-700 p-2 rounded hover:bg-sky-900"
          onClick={async () => {
            const rpcResult = DebugRpc.call(peer.deviceId, "hello world!");
            for await (const result of rpcResult) {
              toast(result);
            }
          }}
        >
          RPC
        </button>

        {peer.lastConnected ? (
          <p className="p-2">
            Last conn: {DefaultTimeFormatter.format(peer.lastConnected)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function IncomingPeers({ peers }: { peers: { deviceId: string }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {peers.map((peer) => (
        <IncomingPeer key={peer.deviceId} peer={peer} />
      ))}
    </div>
  );
}
