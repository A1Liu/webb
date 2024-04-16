"use client";

import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { z } from "zod";
import { getNetworkLayerGlobal } from "../globals";

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
    async function runner() {
      const network = getNetworkLayerGlobal();
      while (run) {
        const chunk = await network.recv({ peerId, channel });
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
  }, []);

  return {
    send: async (data) => {
      try {
        const network = getNetworkLayerGlobal();
        await network.sendData({ peerId, data, channel });
      } catch (e) {
        toast.error(String(e));
      }
    },
  };
}

function IncomingPeer({ peer }: { peer: { id: string } }) {
  const { send } = usePeer(peer.id, {
    schema: z.string(),
    onData: (data) => {
      toast(`data=${data}`);
    },
  });

  return (
    <div className="flex items-center gap-2 p-1 border rounded">
      <p className="text-ellipsis basis-0 grow overflow-hidden">
        {peer.id.replaceAll("-", "")}
      </p>

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
