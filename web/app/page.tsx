"use client";

import { Peer } from "peerjs";

export const dynamic = "force-static";

declare global {
  interface Window {
    peer?: Peer;
  }
}

const peer = new Peer("aliu-web-id");
window.peer = peer;

peer.on("connection", (conn) => {
  conn.on("open", () => {
    console.log("conn");

    conn.on("data", (data) => {
      console.log("data", data);
      conn.send("ack\n");

      setTimeout(() => conn.send(String(data) + "\n"), 500);
    });
  });
});

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24"></main>
  );
}
