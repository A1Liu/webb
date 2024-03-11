"use client";

import { NetworkLayer } from "@a1liu/webb-ui-shared/network";
import { useEffect } from "react";

export const dynamic = "force-static";

const networkLayer = new NetworkLayer("aliu-web-id");

export default function Home() {
  useEffect(() => {
    networkLayer
      .listen()
      .then(async (conn) => {
        const channel = conn.defaultChannel;
        while (true) {
          const data = await channel.pop();
          const text = new TextDecoder().decode(data);
          console.log("received text", { text });
        }
      })
      .catch((err) => {
        console.log("ehlp", err);
      });
  }, []);

  return (
    <main>
      <div className="flex min-h-screen flex-col items-center justify-between p-24"></div>
    </main>
  );
}
