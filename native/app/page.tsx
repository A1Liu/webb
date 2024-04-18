"use client";

import { useUserProfile } from "@/components/state/userProfile";
import { buttonClass, TopbarLayout } from "@/components/TopbarLayout";
import Link from "next/link";
import { toCanvas } from "qrcode";
import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { useDeviceProfile } from "../components/state/deviceProfile";

export const dynamic = "force-static";

function DeviceQr({ deviceId }: { deviceId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvasRef.current || !deviceId) return;

    toCanvas(canvasRef.current, deviceId).catch((error) => {
      toast.error(`QR Code error: ${String(error)}`, {
        duration: 30_000,
      });
    });
  }, [deviceId]);

  return <canvas ref={canvasRef} />;
}

function UserProfileChoice() {
  const { isHydrated, deviceProfile } = useDeviceProfile();
  const {
    userProfile,
    cb: { createUserProfile },
  } = useUserProfile();

  if (!isHydrated || !deviceProfile) {
    return <p className="text-bold">Loading</p>;
  }

  if (!userProfile) {
    return (
      <>
        <h3>Scan Device ID</h3>
        <DeviceQr deviceId={deviceProfile.id} />

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

      <h3>User ID</h3>

      <DeviceQr deviceId={userProfile.publicAuthUserId} />
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
