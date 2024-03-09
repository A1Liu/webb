"use client";

import { NetworkLayer } from "@a1liu/webb-ui-shared/peer";
import { useEffect } from "react";

export const dynamic = "force-static";

const networkLayer = new NetworkLayer("aliu-web-id");

export default function Home() {
  useEffect(() => {
    networkLayer
      .listen()
      .then(async (conn) => {})
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
