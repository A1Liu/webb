import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ZustandIdbStorage } from "../util";
import { GlobalInitGroup } from "../constants";
import {
  Action,
  Identity,
  Permission,
  PermissionResult,
  createPermission,
  PermissionSchema,
  matchPermission,
  verifyPermissionSignature,
  Authority,
  RootIdentity,
  permissionEqual,
  MatchPerms,
} from "../permissions";
import { z } from "zod";
import { registerRpcHandler } from "../network";
import { useGlobals } from "./appGlobals";
import { useUserProfile } from "./userProfile";
import { useDeviceProfile } from "./deviceProfile";
import { isEqual } from "lodash";
import { NetworkLayer } from "@a1liu/webb-tools/network";

// Only 1 lock ID for now

interface PermissionCacheState {
  permissionCache: Map<string, Permission>;
  cb: {
    findPermission: (action: Action) => Permission | undefined;
    createPermission: (
      permissionInput: Omit<Permission, "cert" | "createdAt">,
      authorityKind: Authority["authorityKind"],
      identity: RootIdentity,
    ) => Promise<Permission>;
    verifyPermissions: (
      permission: Permission,
      action: Action,
      identity: Identity,
    ) => Promise<PermissionResult>;
  };
}

export const usePermissionCache = create<PermissionCacheState>()(
  persist(
    (set, get) => {
      return {
        permissionCache: new Map(),
        cb: {
          createPermission: async (
            permissionInput,
            authorityKind,
            identity,
          ) => {
            const { permissionCache } = get();
            for (const permission of permissionCache.values()) {
              // TODO: omg this is all so wrong, none of this is robust holy shit
              if (permissionEqual(permissionInput, permission)) {
                console.log("found existing permission");
                return permission;
              }
            }

            const finalPermission = await createPermission(
              permissionInput,
              authorityKind,
              identity,
            );

            set(({ permissionCache }) => {
              const newCache = new Map(permissionCache);
              newCache.set(finalPermission.cert.signature, finalPermission);
              return { permissionCache: newCache };
            });

            return finalPermission;
          },
          findPermission: (action) => {
            const { permissionCache } = get();
            for (const permission of permissionCache.values()) {
              if (matchPermission(permission, action)) return permission;
            }

            return undefined;
          },
          verifyPermissions: async (permission, action, identity) => {
            const { cert } = permission;
            const previousPermission = get().permissionCache.get(
              cert.signature,
            );
            if (
              !previousPermission ||
              !isEqual(previousPermission.cert, permission.cert)
            ) {
              const valid = await verifyPermissionSignature(
                permission,
                identity,
              );
              if (!valid) return PermissionResult.CertFailure;

              set(({ permissionCache }) => {
                const newCache = new Map(permissionCache);
                newCache.set(permission.cert.signature, permission);
                return { permissionCache: newCache };
              });
            }

            if (!matchPermission(permission, action))
              return PermissionResult.MatchFailure;

            if (!permission.allow) return PermissionResult.Reject;
            return PermissionResult.Allow;
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

export const AskPermission = registerRpcHandler({
  group: GlobalInitGroup,
  rpc: NetworkLayer.createRpc({
    name: "AskPermission",
    input: z.object({
      action: PermissionSchema.pick({ resourceId: true, actionId: true }),
    }),
    output: z.object({ permission: PermissionSchema }),
  }),
  handler: async function* (peerId, { action }) {
    const { userProfile } = useUserProfile.getState();
    if (!userProfile?.secret) return;

    const { deviceProfile } = useDeviceProfile.getState();
    if (!deviceProfile) return;

    const { cb: permCb } = usePermissionCache.getState();

    const globalsCb = useGlobals.getState().cb;

    const allowed = await globalsCb.runPermissionFlow({
      title: `Grant permission to ${peerId}?`,
      description: `Requesting to do ${JSON.stringify(
        action.actionId,
      )} with ${JSON.stringify(action.resourceId)}`,
      options: ["Deny", "Allow", "Allow in Folder", "Always Allow"] as const,
    });

    let permissionAction = { ...action, allow: true };
    switch (allowed) {
      case "Deny":
        return;
      case "Allow":
        break;

      case "Allow in Folder":
        permissionAction = {
          resourceId: [
            ...action.resourceId.slice(0, action.resourceId.length - 1),
            MatchPerms.AnyRemaining,
          ],
          actionId: permissionAction.actionId,
          allow: true,
        };
        break;

      case "Always Allow":
        permissionAction = {
          resourceId: [MatchPerms.AnyRemaining],
          actionId: permissionAction.actionId,
          allow: true,
        };
        break;
    }

    const permissionInput = {
      deviceId: [MatchPerms.exact(peerId)],
      userId: [MatchPerms.exact(userProfile.id)],
      ...permissionAction,
    };

    const permission = await permCb.createPermission(
      permissionInput,
      "userRoot",
      { ...userProfile, ...userProfile.secret },
    );

    yield { permission };
  },
});
