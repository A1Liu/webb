"use client";

import { useEffect } from "react";

export const dynamic = "force-static";

export default function Home() {
  useEffect(() => {
    setTimeout(() => (window.location.href = "/notes"), 1000);
  }, []);

  return "Loading";
}
