"use client";

import { TopbarLayout } from "@/components/TopbarLayout";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useDeviceProfile } from "../components/state/deviceProfile";

export const dynamic = "force-static";

export default function Home() {
  const { isHydrated, deviceProfile } = useDeviceProfile();
  const router = useRouter();

  useEffect(() => {
    if (isHydrated && deviceProfile) {
      router.push("/notes");
    }
  }, [router, isHydrated, deviceProfile]);

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
      <p className="text-bold">Loading</p>
    </TopbarLayout>
  );
}
