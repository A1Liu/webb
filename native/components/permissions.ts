import stringify from "fast-json-stable-stringify";
import { z } from "zod";
import { base64ToBytes, bytesToBase64 } from "./util";

export type PermissionMatcher = z.infer<typeof PermissionMatcherSchema>;
const PermissionMatcherSchema = z
  .discriminatedUnion("__typename", [
    z.object({ __typename: z.literal("Exact"), value: z.string() }),
    z.object({ __typename: z.literal("Prefix"), value: z.string() }),
    z.object({ __typename: z.literal("Any") }),
    z.object({ __typename: z.literal("AnyRemainingSlots") }),
  ])
  .array();

export type Authority = z.infer<typeof AuthoritySchema>;
const AuthoritySchema = z.discriminatedUnion("authorityKind", [
  // The authority needs to be recognized by the device/user which is verifying
  // the permission. E.g.
  //
  // - If the user isn't logged into the device, we auto-reject the permission
  // - If in the future we do device permissions, and the device ID isn't this device,
  //   auto-reject.
  z.object({ authorityKind: z.literal("userRoot"), id: z.string() }),
]);

const CertSchema = z.object({
  signature: z.string(),
  authority: AuthoritySchema,
});

// We've basically re-invented AWS permissions. Which... I guess is fine. It's not
// like I can import them.
export type Permission = z.infer<typeof PermissionSchema>;
export const PermissionSchema = z.object({
  // NOTE: prefix doesn't really make sense here, but... whatever. Any and Exact
  // do make sense.
  deviceId: PermissionMatcherSchema,
  userId: PermissionMatcherSchema,

  resourceId: PermissionMatcherSchema,
  actionId: PermissionMatcherSchema,

  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),

  cert: CertSchema,
});

export interface Identity {
  id: string;
  publicKey: CryptoKey;
}
export interface RootIdentity extends Identity {
  privateKey: CryptoKey;
}

export class Permissions {
  constructor(
    readonly deviceId: string,
    readonly userId: string,
    readonly permissionCache: Map<string, Permission> = new Map(),
  ) {}

  findMyPermission(action: { resourceId: string[]; actionId: string[] }) {
    for (const permission of this.permissionCache.values()) {
      if (!match([this.deviceId], permission.deviceId)) continue;
      if (!match([this.userId], permission.userId)) continue;
      if (!match(action.resourceId, permission.resourceId)) continue;
      if (!match(action.actionId, permission.actionId)) continue;

      return permission;
    }
  }

  async createPermission(
    permissionInput: Omit<Permission, "cert" | "createdAt">,
    authorityKind: Authority["authorityKind"],
    identity: RootIdentity,
  ): Promise<Permission> {
    const permission = { createdAt: new Date(), ...permissionInput };

    const json = stringify(permission);
    const signature = await window.crypto.subtle.sign(
      { name: "RSA-PSS", saltLength: 32 },
      identity.privateKey,
      new TextEncoder().encode(json),
    );

    const finalPermission = {
      ...permission,
      cert: {
        signature: bytesToBase64(signature),
        authority: {
          authorityKind,
          id: identity.id,
        },
      },
    };

    this.permissionCache.set(finalPermission.cert.signature, finalPermission);

    return finalPermission;
  }

  async verifyPermissionSignature(
    permission: Permission,
    identity: Identity,
  ): Promise<boolean> {
    const { cert, ...permissionData } = permission;
    const previousPermission = this.permissionCache.get(cert.signature);
    if (
      previousPermission &&
      previousPermission.cert.signature === permission.cert.signature
    ) {
      if (
        permission.cert.authority.id === previousPermission.cert.authority.id
      ) {
        return true;
      }
    }

    if (cert.authority.id !== identity.id) {
      return false;
    }

    const now = new Date();
    if (permissionData.createdAt > now) {
      return false;
    }

    if (
      permissionData.expiresAt !== undefined &&
      permissionData.expiresAt < now
    ) {
      return false;
    }

    const json = stringify(permissionData);
    const valid = await window.crypto.subtle.verify(
      { name: "RSA-PSS", saltLength: 32 },
      identity.publicKey,
      base64ToBytes(cert.signature),
      new TextEncoder().encode(json),
    );

    this.permissionCache.set(permission.cert.signature, permission);

    return valid;
  }

  async verifyPermission(
    permission: Permission,
    action: {
      deviceId: string;
      userId: string;
      resourceId: string[];
      actionId: string[];
    },
    identity: Identity,
  ): Promise<boolean> {
    const permissionValid = await this.verifyPermissionSignature(
      permission,
      identity,
    );
    if (!permissionValid) return false;

    if (!match([action.deviceId], permission.deviceId)) return false;
    if (!match([action.userId], permission.userId)) return false;
    if (!match(action.resourceId, permission.resourceId)) return false;
    if (!match(action.actionId, permission.actionId)) return false;

    return true;
  }
}

function match(key: string[], permMatcher: PermissionMatcher): boolean {
  let matcherIndex = 0;
  for (const matcher of permMatcher) {
    const index = matcherIndex++;

    switch (matcher.__typename) {
      case "Exact": {
        if (key[index] !== matcher.value) {
          return false;
        }
        break;
      }
      case "Prefix": {
        if (!key[index]?.startsWith(matcher.value)) {
          return false;
        }
        break;
      }
      case "Any": {
        break;
      }
      case "AnyRemainingSlots": {
        if (index < permMatcher.length - 1) {
          console.error("AnyRemainingSlots wasn't last");
          return false;
        }

        matcherIndex = key.length;
        break;
      }
    }
  }

  if (matcherIndex < key.length) {
    return false;
  }

  return true;
}
