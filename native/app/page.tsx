"use client";

import { NIL as uuidNIL } from "uuid";
import React, { useEffect, useRef } from "react";
import { getId, memoize } from "@a1liu/webb-ui-shared/util";
import { NetworkLayer, PeerConnection } from "@a1liu/webb-ui-shared/network";

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

      connectionRef.current.sendPacket(uuidNIL, new TextEncoder().encode(s));
    },
  };
}

const buttonClass = "bg-sky-700 p-2 rounded hover:bg-sky-900";

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
      <div className="flex gap-2">
        <button
          className={buttonClass}
          onClick={async () => {
            const peer = getNetworkLayerGlobal().peer;
            if (!peer?.disconnected) return;
            peer.reconnect();
          }}
        >
          Reconnect
        </button>

        <button
          className={buttonClass}
          onClick={() => {
            connect();
          }}
        >
          Connect
        </button>
        <button
          className={buttonClass}
          onClick={() => {
            send(text);
          }}
        >
          Submit
        </button>
      </div>
    </main>
  );
}
