"use client";

import { timeout } from "@a1liu/webb-ui-shared/util";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { z } from "zod";
import { GlobalInitGroup } from "../constants";
import { getNetworkLayerGlobal, registerRpc } from "../network";
import { usePeers } from "../state/peers";

interface PeerContext {
  send: (s: string) => void;
}

export function usePeer<T>(
  peerId: string,
  {
    channel = "debug",
    schema,
    onData,
  }: {
    channel?: string;
    schema: z.ZodSchema<T>;
    onData: (data: T) => void;
  },
): PeerContext {
  const dataListenerRef = useRef<(data: T) => void>(onData);
  dataListenerRef.current = onData;

  useEffect(() => {
    let run = true;
    const timeoutMs = 1000; // TODO: maybe this should vary
    async function runner() {
      const network = await getNetworkLayerGlobal();
      while (run) {
        const chunk = await Promise.race([
          network.recv({ peerId, channel }),
          timeout(timeoutMs),
        ]);
        if (!chunk) {
          continue;
        }

        const result = schema.safeParse(chunk.data);
        if (result.success) {
          dataListenerRef.current(result.data);
        } else {
          console.error(`Failed parse`, result.error);
        }
      }
    }

    runner();

    return () => {
      run = false;
    };
  }, [channel, peerId, schema]);

  return {
    send: async (data) => {
      try {
        const network = await getNetworkLayerGlobal();
        await network.sendData({ peerId, data, channel });
      } catch (e) {
        toast.error(String(e));
      }
    },
  };
}

const RpcDebug = registerRpc({
  group: GlobalInitGroup,
  name: "RpcDebug",
  input: z.string(),
  output: z.string(),
  rpc: async function* (_peerId, input) {
    toast("rpc called");
    yield* input.split(" ");
  },
});

const schema = z.string();
function IncomingPeer({ peer }: { peer: { id: string } }) {
  const { cb } = usePeers();
  const [open, setOpen] = useState(false);
  const { send } = usePeer(peer.id, {
    schema,
    onData: (data) => {
      toast(`blarka=${data}`);
    },
  });

  return (
    <div className="flex flex-col gap-2 p-1 border rounded">
      <div className="flex items-center">
        <button
          className="text-ellipsis basis-0 grow overflow-hidden"
          onClick={() => setOpen((prev) => !prev)}
        >
          {peer.id.replaceAll("-", "")}
        </button>

        <div className="flex gap-2">
          <button
            className="bg-sky-700 p-2 rounded hover:bg-sky-900"
            onClick={async () => {
              try {
                send("hi");
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
            const rpcResult = RpcDebug.call(peer.id, "hello world!");
            for await (const result of rpcResult) {
              toast(result);
            }
          }}
        >
          RPC
        </button>
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
