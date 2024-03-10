"use client";

import React, { useEffect, useRef } from "react";
import { getId, memoize } from "@a1liu/webb-ui-shared/util";
import { NetworkLayer, PeerConnection } from "@a1liu/webb-ui-shared/peer";

export const dynamic = "force-static";

declare global {
  interface Window {
    peer?: NetworkLayer;
  }
}

const getNetworkLayerGlobal = memoize(() => {
  return new NetworkLayer(getId());
});

interface PeerContext {
  connect: () => Promise<void>;
  send: (s: string) => void;
}

function usePeer(
  target: string,
  opts: { onData: (data: unknown) => void },
): PeerContext {
  const connectionRef = useRef<PeerConnection>();
  const dataListenerRef = useRef<(data: unknown) => void>(opts.onData);

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

      connectionRef.current._sendRawPacket(new TextEncoder().encode(s));
    },
  };
}

export default function Home() {
  const [text, setText] = React.useState("asdf");

  const [resp, setResp] = React.useState("");
  const { send, connect } = usePeer("aliu-web-id", {
    onData: (data) => {
      setResp((prev) => prev + String(data));
    },
  });

  useEffect(() => {
    // navigator.mediaDevices.getUserMedia({ audio: true }).then((e) => {
    // });
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      Hello World
      <div className="bg-white h-16 w-full">
        <pre>
          <code className="text-black">{resp}</code>
        </pre>
      </div>
      <input
        className="text-black"
        value={text}
        onChange={(evt) => setText(evt.target.value)}
      />
      <button
        onClick={() => {
          connect();
        }}
      >
        Connect
      </button>
      <button
        onClick={() => {
          send(text);
        }}
      >
        Submit
      </button>
    </main>
  );
}
