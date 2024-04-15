"use client";

import { useEffect, useRef } from "react";
import { getId, timeout } from "@a1liu/webb-ui-shared/util";
import { NetworkLayer, PeerConnection } from "@a1liu/webb-ui-shared/network";
import { registerGlobal } from "../constants";
import toast from "react-hot-toast";
import { create } from "zustand";

const getNetworkLayerGlobal = registerGlobal("networkLayer", () => {
  return new NetworkLayer(getId());
});

interface PeerContext {
  connect: (target: string) => Promise<void>;
  send: (s: string) => void;
}

export function usePeer(opts: { onData: (data: string) => void }): PeerContext {
  const connectionRef = useRef<PeerConnection>();
  const dataListenerRef = useRef<(data: string) => void>(opts.onData);
  dataListenerRef.current = opts.onData;

  useEffect(() => {
    let run = true;
    async function runner() {
      while (run) {
        if (connectionRef.current === undefined) {
          await timeout(1000);
          continue;
        }

        const data = await connectionRef.current.recv();
        dataListenerRef.current(data);
      }
    }

    runner();

    return () => {
      run = false;
    };
  }, []);

  return {
    connect: async (target) => {
      try {
        const layer = getNetworkLayerGlobal();
        const conn = await layer.connect(target);
        toast("connected!");

        if (connectionRef.current !== undefined) {
          connectionRef.current.close();
        }

        connectionRef.current = conn;
      } catch (e) {
        toast.error(String(e));
      }
    },
    send: (s) => {
      if (connectionRef.current === undefined) {
        return;
      }

      const channel = connectionRef.current;
      channel.send(s);
    },
  };
}

interface ChannelInfo {
  peers: PeerConnection[];
  init: () => unknown;
}

const usePeers = create<ChannelInfo>((set) => {
  let init = false;
  return {
    peers: [],
    init: async () => {
      if (init) return;
      init = true;

      while (true) {
        const peer = await getNetworkLayerGlobal().listen();
        set((prev) => ({
          peers: [...prev.peers, peer],
        }));
      }
    },
  };
});

function IncomingPeer({ peer }: { peer: PeerConnection }) {
  useEffect(() => {
    let run = true;
    async function runner() {
      while (run) {
        const data = await peer.recv();
        toast(`data=${data}`);
      }
    }

    runner();

    return () => {
      run = false;
    };
  }, [peer]);
  return (
    <div className="flex gap-2 p-3">
      <p>Peer {peer.name}</p>

      <button
        className="bg-sky-700 p-2 rounded hover:bg-sky-900"
        onClick={async () => {
          try {
            await peer.send("hi");
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

export function IncomingPeers() {
  const { peers, init } = usePeers();
  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="flex flex-col gap-2">
      {peers.map((peer) => (
        <IncomingPeer key={peer.name} peer={peer} />
      ))}
    </div>
  );
}
