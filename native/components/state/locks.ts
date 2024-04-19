import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ZustandIdbStorage } from "../util";
import { GlobalInitGroup } from "../constants";
import {
  PermissionKey,
  PermissionKeySchema,
  PermissionLock,
  PermissionLockHelpers,
} from "../crypto";
import { useUserProfile } from "./userProfile";
import toast from "react-hot-toast";
import { useDeviceProfile } from "./deviceProfile";
import { registerRpc } from "../network";
import { z } from "zod";
import { useGlobals } from "./appGlobals";
import { Future } from "@/../ui-shared/dist/util";

// Only 1 lock ID for now

interface LockStoreState {
  keyCache: Map<
    string,
    { key: Omit<PermissionKey, "base64Signature">; pass: boolean }
  >;
  thisDeviceKeyCache: Map<string, PermissionKey>;
  thisDeviceKeyCacheRunning: Map<string, Promise<PermissionKey>>;
  locks: Map<string, PermissionLock>;
  cb: {
    getLock: () => PermissionLock | undefined;
    createLock: (name: string) => Promise<PermissionLock>;
    addKey: (key: PermissionKey) => void;
    createKey: (
      lockId: string,
      deviceId?: string,
    ) => Promise<PermissionKey | undefined>;
    addLock: (lock: PermissionLock) => Promise<boolean>;
    verifyKey: (
      key: PermissionKey,
    ) => Promise<{ type: "done"; valid: boolean } | { type: "missingLock" }>;
  };
}

export const useLocks = create<LockStoreState>()(
  persist(
    (set, get) => {
      return {
        keyCache: new Map(),
        locks: new Map(),
        thisDeviceKeyCache: new Map(),
        thisDeviceKeyCacheRunning: new Map(),
        cb: {
          getLock: () => {
            for (const lock of get().locks.values()) {
              return lock;
            }

            // TODO: this is dumb
            return undefined;
          },
          createLock: async (name) => {
            const userProfile = useUserProfile.getState().userProfile;
            if (!userProfile) {
              const message = `Can't create lock ${name}, not logged in!`;
              toast.error(message);
              throw new Error(message);
            }

            const privateKey = userProfile.secret?.privateAuthKey;
            if (!privateKey) {
              const message = `Can't create lock ${name}, missing secret!`;
              toast.error(message);
              throw new Error(message);
            }

            const lock = await PermissionLockHelpers.createLock(
              name,
              privateKey,
            );

            set((prev) => {
              const newLocks = new Map(prev.locks);
              newLocks.set(lock.id, lock);
              return { locks: newLocks };
            });

            return lock;
          },
          addLock: async (lock) => {
            const userProfile = useUserProfile.getState().userProfile;
            if (!userProfile) {
              const message = `Can't add lock ${name}, not logged in!`;
              toast.error(message);
              throw new Error(message);
            }

            const pass = await PermissionLockHelpers.verifyLock(
              lock,
              userProfile.publicAuthKey,
            );
            if (!pass) {
              const message = `Lock ${name} failed to verify`;
              toast.error(message);
              return false;
            }

            set((prev) => {
              const newLocks = new Map(prev.locks);
              newLocks.set(lock.id, lock);
              return { locks: newLocks };
            });

            return true;
          },
          addKey: (key) => {
            const { thisDeviceKeyCache } = get();
            const prevKey = thisDeviceKeyCache.get(key.lockId);
            if (prevKey) {
              return;
            }

            const deviceId = useDeviceProfile.getState().deviceProfile?.id;
            if (!deviceId) {
              throw new Error("Don't have device ID to create key with");
            }

            if (deviceId !== key.deviceId) {
              throw new Error("Key doesn't match this device's ID");
            }

            // TODO: verify key validity
            thisDeviceKeyCache.set(key.lockId, key);
          },
          createKey: async (lockId, inputDeviceId) => {
            const { thisDeviceKeyCache, thisDeviceKeyCacheRunning, locks } =
              get();
            const prevKey = thisDeviceKeyCache.get(lockId);
            if (prevKey) {
              return prevKey;
            }
            const prevKeyRunning = thisDeviceKeyCacheRunning.get(lockId);
            if (prevKeyRunning) {
              return await prevKeyRunning;
            }

            const deviceId =
              inputDeviceId ?? useDeviceProfile.getState().deviceProfile?.id;
            if (!deviceId) {
              return undefined;
              // throw new Error("Don't have device ID to create key with");
            }

            const lock = locks.get(lockId);
            if (!lock) {
              return undefined;
              // throw new Error(`Don't have lockId=${lockId} to create key with`);
            }
            const secret = lock.secret;
            if (!secret) {
              return undefined;
              // throw new Error(
              //   `Don't have secret for Lock(${lock.name}) to create key with`
              // );
            }

            const fut = new Future<PermissionKey>();
            thisDeviceKeyCacheRunning.set(lockId, fut.promise);

            const key = await PermissionLockHelpers.createKey(deviceId, {
              ...lock,
              secret,
            });

            fut.resolve(key);
            thisDeviceKeyCacheRunning.delete(lockId);
            thisDeviceKeyCache.set(lockId, key);

            return key;
          },
          verifyKey: async (key) => {
            const { locks, keyCache } = get();
            const cachedKey = keyCache.get(key.keyId);
            if (
              !!cachedKey &&
              cachedKey.key.lockId === key.lockId &&
              cachedKey.key.deviceId === key.deviceId &&
              cachedKey.key.expirationDate === key.expirationDate
            ) {
              return { type: "done", valid: cachedKey.pass };
            }
            const lock = locks.get(key.lockId);
            if (!lock) {
              return { type: "missingLock" };
            }

            const pass = await PermissionLockHelpers.unlock(lock, key);

            const newKeyCache = new Map(keyCache);
            newKeyCache.set(key.keyId, {
              pass,
              key: {
                __typename: key.__typename,
                keyId: key.keyId,
                lockId: key.lockId,
                deviceId: key.deviceId,
                expirationDate: key.expirationDate,
              },
            });
            set({
              keyCache: newKeyCache,
            });

            return { type: "done", valid: pass };
          },
        },
      };
    },
    {
      name: "lock-storage",
      storage: ZustandIdbStorage,
      skipHydration: true,
      partialize: ({ cb, thisDeviceKeyCacheRunning, ...rest }) => ({
        ...rest,
      }),
    },
  ),
);

GlobalInitGroup.registerInit("LockStoreState", () => {
  useLocks.persist.rehydrate();
});

export const RequestKeyForLock = registerRpc({
  name: "RequestKeyForLock",
  group: GlobalInitGroup,
  input: z.object({ lockId: z.string() }),
  output: z.object({ key: PermissionKeySchema.nullish() }),
  rpc: async function* (peerId, { lockId }) {
    console.debug(`received GetKeyAuth req`, peerId);

    const perm = await useGlobals.getState().cb.runPermissionFlow({
      title: "Grant device a key?",
      description: `Device=${peerId}, lock=${lockId}`,
    });
    if (!perm) return;

    const key = await useLocks.getState().cb.createKey(lockId, peerId);

    yield { key };
  },
});
