import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { persist } from "zustand/middleware";
import { ZustandIdbStorage } from "../util";
import { Future } from "@a1liu/webb-ui-shared/util";
import { GlobalInitGroup } from "../constants";

export interface DeviceProfile {
  id: string;
}

interface DeviceProfileState {
  isHydrated: boolean;
  hydrationPromise: Future<true>;
  deviceProfile: DeviceProfile | undefined;
  cb: {
    _setHydrate: () => void;
    _initDeviceProfile: (profile: DeviceProfile) => void;
  };
}

export const useDeviceProfile = create<DeviceProfileState>()(
  persist(
    (set) => {
      return {
        hydrationPromise: new Future<true>(),
        isHydrated: false,
        deviceProfile: undefined,
        peers: new Map(),
        cb: {
          _setHydrate: () => {
            set({ isHydrated: true });
          },
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
      partialize: ({ cb, isHydrated, hydrationPromise, ...rest }) => ({
        ...rest,
      }),
      onRehydrateStorage: ({ hydrationPromise, cb }) => {
        console.log("device-id rehydrate started");
        return (hydratedState, _error) => {
          console.log("device-id rehydrate finished");
          if (!hydratedState?.deviceProfile) {
            cb._initDeviceProfile({ id: uuid() });
          }

          cb._setHydrate();
          hydrationPromise.resolve(true);
        };
      },
    }
  )
);

GlobalInitGroup.registerInit("DeviceProfileState", () => {
  useDeviceProfile.persist.rehydrate();
});
