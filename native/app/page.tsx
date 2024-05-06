"use client";

import { TopbarLayout } from "@/components/TopbarLayout";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDeviceProfile } from "../components/state/deviceProfile";

export const dynamic = "force-static";

export default function Home() {
  const { isHydrated, deviceProfile } = useDeviceProfile();
  const navigate = useNavigate();

  useEffect(() => {
    if (isHydrated && deviceProfile) {
      navigate("/notes");
    }
  }, [navigate, isHydrated, deviceProfile]);

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
