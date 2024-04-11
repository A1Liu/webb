"use client";

import { useRef } from "react";
import { getId } from "@a1liu/webb-ui-shared/util";
import { NetworkLayer, PeerConnection } from "@a1liu/webb-ui-shared/network";
import { registerGlobal } from "../constants";

const getNetworkLayerGlobal = registerGlobal("networkLayer", () => {
  return new NetworkLayer(getId());
});

interface PeerContext {
  connect: () => Promise<void>;
  send: (s: string) => void;
}

export function usePeer(
  target: string,
  opts: { onData: (data: string) => void }
): PeerContext {
  const connectionRef = useRef<PeerConnection>();
  const dataListenerRef = useRef<(data: string) => void>(opts.onData);

  dataListenerRef.current = opts.onData;

  return {
    connect: async () => {
      const layer = getNetworkLayerGlobal();
      const conn = await layer.connect(target);

      if (connectionRef.current !== undefined) {
        connectionRef.current.close();
      }

      connectionRef.current = conn;
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
