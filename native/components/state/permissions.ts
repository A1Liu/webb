import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ZustandIdbStorage } from "../util";
import { GlobalInitGroup } from "../constants";
import {
  Permission,
  PermissionSchema,
  PermissionsManager,
} from "../permissions";
import { z } from "zod";
import { registerRpc } from "../network";
import { useGlobals } from "./appGlobals";
import { useUserProfile } from "./userProfile";
import { useDeviceProfile } from "./deviceProfile";

// Only 1 lock ID for now

interface PermissionCacheState {
  permissionCache: Map<string, Permission>;
  cb: {
    updateCache: (p: Map<string, Permission>) => void;
  };
}

export const usePermissionCache = create<PermissionCacheState>()(
  persist(
    (set) => {
      return {
        permissionCache: new Map(),
        cb: {
          updateCache: (cache) => {
            set({ permissionCache: new Map(cache) });
          },
        },
      };
    },
    {
      name: "permission-cache-storage",
      storage: ZustandIdbStorage,
      skipHydration: true,
      partialize: ({ cb, ...rest }) => ({
        ...rest,
      }),
    },
  ),
);

GlobalInitGroup.registerInit("PermissionCacheState", () => {
  usePermissionCache.persist.rehydrate();
});

export const AskPermission = registerRpc({
  name: "AskPermission",
  group: GlobalInitGroup,
  input: z.object({
    action: PermissionSchema.pick({ resourceId: true, actionId: true }),
  }),
  output: z.object({ permission: PermissionSchema }),
  rpc: async function* (peerId, { action }) {
    const { userProfile } = useUserProfile.getState();
    if (!userProfile?.secret) return;

    const { deviceProfile } = useDeviceProfile.getState();
    if (!deviceProfile) return;

    const globalsCb = useGlobals.getState().cb;

    const allowed = await globalsCb.runPermissionFlow({
      title: `Grant permission to ${peerId}?`,
      description: `Requesting to do ${JSON.stringify(
        action.actionId,
      )} with ${JSON.stringify(action.resourceId)}`,
      options: ["Deny", "Allow", "Always Allow"] as const,
    });

    let permissionAction = action;
    switch (allowed) {
      case "Deny":
        return;
      case "Allow":
        break;

      case "Always Allow":
        permissionAction = {
          resourceId: [{ __typename: "Any" as const }],
          actionId: [{ __typename: "Any" as const }],
        };
        break;
    }

    const { permissionCache, cb: permCb } = usePermissionCache.getState();
    const permissions = new PermissionsManager(
      deviceProfile.id,
      userProfile.publicAuthUserId,
      permissionCache,
    );

    const permissionInput = {
      deviceId: [{ __typename: "Exact" as const, value: peerId }],
      userId: [
        { __typename: "Exact" as const, value: userProfile.publicAuthUserId },
      ],
      ...permissionAction,
    };

    const permission = await permissions.createPermission(
      permissionInput,
      "userRoot",
      {
        id: userProfile.publicAuthUserId,
        publicKey: userProfile.publicAuthKey,
        privateKey: userProfile.secret.privateAuthKey,
      },
    );
    permCb.updateCache(permissions.permissionCache);

    yield { permission };
  },
});
