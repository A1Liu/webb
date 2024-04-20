import { Format, scan } from "@tauri-apps/plugin-barcode-scanner";
import { toCanvas } from "qrcode";
import { useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { z } from "zod";
import { GlobalInitGroup } from "./constants";
import {
  exportUserPublickKey,
  importUserPublicKey,
  verifyUserKey,
} from "./crypto";
import { usePlatform } from "./hooks/usePlatform";
import {
  getNetworkLayerGlobal,
  registerListener,
  registerRpc,
} from "./network";
import { useGlobals } from "./state/appGlobals";
import { useDeviceProfile } from "./state/deviceProfile";
import { useUserProfile } from "./state/userProfile";
import { buttonClass } from "./TopbarLayout";

const JoinMe = registerRpc({
  name: "JoinMe",
  group: GlobalInitGroup,
  input: z.object({ userId: z.string(), userPublicKey: z.string() }),
  output: z.object({ success: z.boolean() }),
  rpc: async function* (_peerId, { userId, userPublicKey }) {
    const publicAuthKey = await importUserPublicKey(userPublicKey);

    const verified = await verifyUserKey(publicAuthKey, userId);
    if (!verified) {
      toast.error(`Failed to verify during join`);
      return;
    }

    useUserProfile.getState().cb.updateUserProfile({
      publicAuthUserId: userId,
      publicAuthKey,
    });

    yield { success: true };
  },
});

const MayIJoinListener = registerListener({
  group: GlobalInitGroup,
  channel: "MayIJoin",
  schema: z.object({}),
  listener: async (peerId, _data) => {
    toast(`MayIJoin listener invoked`);

    const userProfile = useUserProfile.getState().userProfile;
    if (!userProfile) {
      toast.error(`Got request to join but didn't have userId`);
      return;
    }

    const userPublicKey = await exportUserPublickKey(userProfile.publicAuthKey);
    const result = JoinMe.call(peerId, {
      userId: userProfile.publicAuthUserId,
      userPublicKey,
    });

    for await (const out of result) {
      if (!out.success) {
        toast.error(`Failed to invoke JoinMe from MayIJoin`);
      }
    }
  },
});

export type DeviceQrData = z.infer<typeof DeviceQrDataSchema>;
const DeviceQrDataSchema = z.object({
  deviceId: z.string(),
  userId: z.string().nullish(),
});

export function parseDeviceQrCode(qrData: string): DeviceQrData {
  const data = JSON.parse(qrData);
  return DeviceQrDataSchema.parse(data);
}

export function DeviceQr() {
  const { userProfile } = useUserProfile();
  const { deviceProfile } = useDeviceProfile();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvasRef.current || !deviceProfile) return;

    const data: DeviceQrData = {
      deviceId: deviceProfile.id,
      userId: userProfile?.publicAuthUserId,
    };

    toCanvas(canvasRef.current, JSON.stringify(data)).catch((error) => {
      toast.error(`QR Code error: ${String(error)}`, {
        duration: 30_000,
      });
    });
  }, [deviceProfile, userProfile]);

  return <canvas ref={canvasRef} className="min-w-10 min-h-10" />;
}

export function ScanAndConnectButton() {
  const { isMobile } = usePlatform();
  const globals = useGlobals((s) => s.cb);

  if (!isMobile) {
    return null;
  }

  return (
    <button
      className={buttonClass}
      onTouchStart={async () => {
        await globals.runBackgroundFlow(async () => {
          // `windowed: true` actually sets the webview to transparent
          // instead of opening a separate view for the camera
          // make sure your user interface is ready to show what is underneath with a transparent element
          const result = await scan({
            cameraDirection: "back",
            windowed: true,
            formats: [Format.QRCode],
          });

          const myProfile = useUserProfile.getState().userProfile;
          const device = parseDeviceQrCode(result.content);

          Promise.resolve(null).then(async () => {
            if (myProfile) {
              const userPublicKey = await exportUserPublickKey(
                myProfile.publicAuthKey,
              );
              const result = JoinMe.call(device.deviceId, {
                userId: myProfile.publicAuthUserId,
                userPublicKey,
              });

              for await (const { success } of result) {
                if (!success) {
                  toast.error(`Error during JoinMe`);
                }
              }
            } else if (device.userId) {
              await MayIJoinListener.send(device.deviceId, {});
            } else {
              const network = await getNetworkLayerGlobal();
              network.sendData({
                peerId: result.content,
                channel: "debug",
                data: "peer connect",
              });
            }
          });
        });
      }}
    >
      scan
    </button>
  );
}
