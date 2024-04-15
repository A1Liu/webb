"use client";

import React from "react";
import { TopbarLayout } from "@/components/TopbarLayout";

export const dynamic = "force-static";

export default function Home() {
  return (
    <TopbarLayout
      title={"Home"}
      buttons={[
        {
          type: "link",
          text: "Settings",
          href: "/settings",
        },
        {
          type: "button",
          text: "Refresh",
          onClick: () => window.location.reload(),
        },
      ]}
    >
      hello
    </TopbarLayout>
  );
}
