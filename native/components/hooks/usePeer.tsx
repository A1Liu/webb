"use client";

import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { getNetworkLayerGlobal } from "../globals";

interface PeerContext {
  send: (s: string) => void;
}

export function usePeer(
  peerId: string,
  opts: { onData: (data: string) => void },
): PeerContext {
  const dataListenerRef = useRef<(data: string) => void>(opts.onData);
  dataListenerRef.current = opts.onData;

  useEffect(() => {
    let run = true;
    async function runner() {
      const network = getNetworkLayerGlobal();
      while (run) {
        const data = await network.recv(peerId);
        dataListenerRef.current(data);
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
        await network.sendData({ id: peerId, data });
      } catch (e) {
        toast.error(String(e));
      }
    },
  };
}

function IncomingPeer({ peer }: { peer: { id: string } }) {
  const { send } = usePeer(peer.id, {
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
