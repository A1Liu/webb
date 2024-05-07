import { TopbarLayout } from "@/components/TopbarLayout";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDeviceProfile } from "../components/state/deviceProfile";

export const dynamic = "force-static";

export default function Home() {
  const { deviceProfile } = useDeviceProfile();
  const navigate = useNavigate();

  useEffect(() => {
    if (deviceProfile) {
      navigate("/notes");
    }
  }, [navigate, deviceProfile]);

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
