"use client";

import { DeviceQr } from "@/components/DeviceQrCode";
import { useUserProfile } from "@/components/state/userProfile";
import { buttonClass, TopbarLayout } from "@/components/TopbarLayout";
import Link from "next/link";
import toast from "react-hot-toast";
import { useDeviceProfile } from "../components/state/deviceProfile";

export const dynamic = "force-static";

function UserProfileChoice() {
  const { isHydrated, deviceProfile } = useDeviceProfile();
  const {
    userProfile,
    cb: { createUserProfile, logout },
  } = useUserProfile();

  if (!isHydrated || !deviceProfile) {
    return <p className="text-bold">Loading</p>;
  }

  if (!userProfile) {
    return (
      <>
        <h3>Scan Device ID</h3>
        <DeviceQr />

        <button
          className={buttonClass}
          onClick={async () => {
            await createUserProfile();
            toast("Created user profile");
          }}
        >
          Create User
        </button>

        <Link href={"/notes"}>
          <button className={buttonClass}>Skip setup and go to notes</button>
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href={"/notes"}>
        <button className={buttonClass}>Go to notes</button>
      </Link>

      <button
        className={buttonClass}
        onClick={async () => {
          logout();
          toast("Created user profile");
        }}
      >
        Logout
      </button>

      <h3>User ID</h3>
      <DeviceQr />
    </>
  );
}

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
      <UserProfileChoice />
    </TopbarLayout>
  );
}
