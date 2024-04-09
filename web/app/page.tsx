"use client";

import { memoize } from "@a1liu/webb-ui-shared/util";
import { NetworkLayer } from "@a1liu/webb-ui-shared/network";
import { useEffect } from "react";

export const dynamic = "force-static";

const getNetworkLayerGlobal = memoize(() => {
  return new NetworkLayer("aliu-web-id");
});

export default function Home() {
  useEffect(() => {
    getNetworkLayerGlobal()
      .listen()
      .then(async (conn) => {
        while (true) {
          const text = await conn.recv();
          console.log("received text", { text, tJson: JSON.stringify(text) });
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
