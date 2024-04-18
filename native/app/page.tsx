"use client";

import { TopbarLayout } from "@/components/TopbarLayout";
import { useEffect } from "react";

export const dynamic = "force-static";

export default function Home() {
  useEffect(() => {
    window.location.href = "/notes";
  }, []);

  return <TopbarLayout title={"Loading..."} buttons={[]}></TopbarLayout>;
}
