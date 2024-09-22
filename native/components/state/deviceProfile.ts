import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { persist } from "zustand/middleware";
import { ZustandIdbStorage } from "../util";
import { GlobalInitGroup } from "../constants";
import { Future } from "@a1liu/webb-tools/util";

export const DeviceProfileHydration = new Future<true>();

export interface DeviceProfile {
  id: string;
}

interface DeviceProfileState {
  deviceProfile: DeviceProfile | undefined;
  cb: {
    _initDeviceProfile: (profile: DeviceProfile) => void;
  };
}

export const useDeviceProfile = create<DeviceProfileState>()(
  persist(
    (set) => {
      return {
        deviceProfile: undefined,
        cb: {
          _initDeviceProfile: (deviceProfile) => {
            set({ deviceProfile });
          },
        },
      };
    },
    {
      name: "device-id-storage",
      storage: ZustandIdbStorage,
      skipHydration: true,
      partialize: ({ cb, ...rest }) => ({ ...rest }),
      onRehydrateStorage: ({ cb }) => {
        return (hydratedState, _error) => {
          if (!hydratedState?.deviceProfile) {
            cb._initDeviceProfile({ id: uuid() });
          }

          DeviceProfileHydration.resolve(true);
        };
      },
    },
  ),
);

GlobalInitGroup.registerInit("DeviceProfileState", () => {
  useDeviceProfile.persist.rehydrate();
});
