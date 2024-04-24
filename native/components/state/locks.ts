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
import { Future } from "@a1liu/webb-ui-shared/util";
import stringify from "fast-json-stable-stringify";
import { isEqual } from "lodash";

// Only 1 lock ID for now

interface LockStoreState {
  keyCache: Map<string, { key: PermissionKey; pass: boolean }>;
  keyCacheRunning: Map<string, Promise<PermissionKey>>;
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
      function getCacheKeyForPermKey({
        deviceId,
        lockId,
      }: {
        deviceId: string;
        lockId: string;
      }) {
        return stringify({ deviceId, lockId });
      }

      return {
        keyCache: new Map(),
        locks: new Map(),
        keyCacheRunning: new Map(),
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
            const { keyCache } = get();
            const keyCacheKey = getCacheKeyForPermKey(key);
            const prevKey = keyCache.get(keyCacheKey);
            if (prevKey) {
              return;
            }

            const deviceId = useDeviceProfile.getState().deviceProfile?.id;
            if (!deviceId) {
              throw new Error("Don't have device ID to create key with");
            }

            if (deviceId !== key.deviceId) {
              toast.error(`device ${deviceId}`);
              toast.error(`key ${key.deviceId}`);
              throw new Error("Key doesn't match this device's ID");
            }

            // TODO: verify key validity

            const newKeyCache = new Map(keyCache);
            newKeyCache.set(keyCacheKey, { key, pass: true });

            set({ keyCache: newKeyCache });
          },
          createKey: async (lockId, inputDeviceId) => {
            const deviceId =
              inputDeviceId ?? useDeviceProfile.getState().deviceProfile?.id;
            if (!deviceId) {
              return undefined;
              // throw new Error("Don't have device ID to create key with");
            }

            const { keyCache, keyCacheRunning, locks } = get();

            const keyCacheKey = getCacheKeyForPermKey({ deviceId, lockId });
            const prevKey = keyCache.get(keyCacheKey);
            if (prevKey) {
              return prevKey.key;
            }
            const prevKeyRunning = keyCacheRunning.get(keyCacheKey);
            if (prevKeyRunning) {
              return await prevKeyRunning;
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
            keyCacheRunning.set(keyCacheKey, fut.promise);

            const key = await PermissionLockHelpers.createKey(deviceId, {
              ...lock,
              secret,
            });

            fut.resolve(key);

            keyCacheRunning.delete(keyCacheKey);

            const newKeyCache = new Map(keyCache);
            newKeyCache.set(keyCacheKey, { key, pass: true });

            set({ keyCache: newKeyCache });

            return key;
          },
          verifyKey: async (key: PermissionKey) => {
            const { locks, keyCache } = get();
            const keyCacheKey = getCacheKeyForPermKey(key);
            const cachedKey = keyCache.get(keyCacheKey);

            if (cachedKey && isEqual(cachedKey.key, key)) {
              return { type: "done" as const, valid: cachedKey.pass };
            }
            const lock = locks.get(key.lockId);
            if (!lock) {
              return { type: "missingLock" as const };
            }

            const pass = await PermissionLockHelpers.unlock(lock, key);

            const newKeyCache = new Map<
              string,
              { key: PermissionKey; pass: boolean }
            >(keyCache);
            newKeyCache.set(keyCacheKey, { pass, key });
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
      partialize: ({ cb, keyCacheRunning, ...rest }) => ({
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
    console.debug(`received RequestKeyForLock req`, peerId);

    const { locks, cb } = useLocks.getState();

    const lock = locks.get(lockId);
    if (!lock) {
      console.debug(`RequestKeyForLock failed, don't have lock info`);
      return;
    }

    const perm = await useGlobals.getState().cb.runPermissionFlow({
      title: "Grant device a key?",
      description: `DEVICE=${peerId}\nLOCK=${lock.name} (${lockId})`,
    });
    if (!perm) return;

    const key = await cb.createKey(lockId, peerId);

    yield { key };
  },
});
