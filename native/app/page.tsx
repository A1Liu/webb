"use client";

import React, { useEffect, useRef } from "react";
import { DataConnection, Peer } from "peerjs";
import { create } from "zustand";
import { getId } from "@a1liu/webb-ui-shared";

export const dynamic = "force-static";

declare global {
  interface Window {
    peer?: Peer;
  }
}

const usePeerContext = create<{ peer: Peer }>((_get, _set) => {
  let peer: Peer | null = null;
  return {
    get peer(): Peer {
      if (peer === null) {
        const peerNew = new Peer(getId());
        peer = peerNew;
        window.peer = peerNew;
        return peerNew;
      }

      return peer;
    },
  };
});

interface PeerContext {
  send: (s: string) => void;
}

function usePeer(
  target: string,
  opts: { onData: (data: unknown) => void },
): PeerContext {
  const connectionRef = useRef<DataConnection>();
  const dataListenerRef = useRef<(data: unknown) => void>(opts.onData);
  const ctx = usePeerContext();

  dataListenerRef.current = opts.onData;

  useEffect(() => {
    ctx.peer;
    return () => connectionRef.current?.close();
  }, [ctx, target]);

  return {
    send: (s) => {
      const conn = (() => {
        if (connectionRef.current === undefined) {
          const conn = ctx.peer.connect(target);
          connectionRef.current = conn;

          conn.on("open", () => {
            console.log("open");

            conn.on("data", (data) => {
              console.log("data", data);
              dataListenerRef.current(data);
            });
          });

          return conn;
        }

        return connectionRef.current;
      })();

      conn.send(s);
    },
  };
}

export default function Home() {
  const [text, setText] = React.useState("");

  const [resp, setResp] = React.useState("");
  const { send } = usePeer("aliu-web-id", {
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
          send(text);
        }}
      >
        Submit
      </button>
    </main>
  );
}
