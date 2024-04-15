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
          type: "button",
          text: "Refresh",
          onClick: () => window.location.reload(),
        },
        {
          type: "link",
          text: "Settings",
          href: "/settings",
        },
      ]}
    >
      hello
    </TopbarLayout>
  );
}
