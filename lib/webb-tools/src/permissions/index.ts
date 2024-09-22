import stringify from "fast-json-stable-stringify";
import pick from "lodash/pick";
import isEqual from "lodash/isEqual";
import { z } from "zod";
import { UserKeyAlgorithm, base64ToBytes, bytesToBase64 } from "./crypto";
import { IndexedDbStore } from "../store";
import { Observable } from "../util";

export type PermissionMatcher = z.infer<typeof PermissionMatcherSchema>;
const PermissionMatcherSchema = z
  .discriminatedUnion("__typename", [
    z.object({ __typename: z.literal("Exact"), value: z.string() }),
    z.object({ __typename: z.literal("Prefix"), value: z.string() }),
    z.object({ __typename: z.literal("Any") }),
    z.object({ __typename: z.literal("AnyRemainingSlots") }),
  ])
  .array();

export class MatchPerms {
  static Any = { __typename: "Any" } as const;
  static AnyRemaining = { __typename: "AnyRemainingSlots" } as const;

  static exact(value: string) {
    return { __typename: "Exact" as const, value };
  }
  static prefix(value: string) {
    return { __typename: "Prefix" as const, value };
  }
}

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

export const ActionIdentifierSchema = z.object({
  resourceId: z.string().array(),
  actionId: z.string().array(),
});

export type Action = z.infer<typeof ActionSchema>;
export const ActionSchema = ActionIdentifierSchema.extend({
  deviceId: z.string(),
  userId: z.string(),
});

export enum PermissionResult {
  Allow = "Allow",
  Reject = "Reject",
  CertFailure = "CertFailure",
  MatchFailure = "MatchFailure",
}

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

  allow: z.boolean(),

  cert: CertSchema,
});

export interface Identity {
  id: string;
  publicKey: CryptoKey;
}
export interface RootIdentity extends Identity {
  privateKey: CryptoKey;
}

export function permissionEqual(
  perm1: Omit<Permission, "cert" | "createdAt">,
  perm2: Omit<Permission, "cert" | "createdAt">,
): boolean {
  const fieldNames = ["userId", "resourceId", "deviceId", "actionId"] as const;

  // TODO: omg this is all so wrong, none of this is robust holy shit
  const perm1Fields = pick(perm1, fieldNames);
  const perm2Fields = pick(perm2, fieldNames);

  return isEqual(perm1Fields, perm2Fields);
}

export async function createPermission(
  permissionInput: Omit<Permission, "cert" | "createdAt">,
  authorityKind: Authority["authorityKind"],
  identity: RootIdentity,
): Promise<Permission> {
  const permission: Omit<Permission, "cert"> = {
    actionId: permissionInput.actionId,
    userId: permissionInput.userId,
    deviceId: permissionInput.deviceId,
    resourceId: permissionInput.resourceId,
    allow: permissionInput.allow,

    createdAt: getLowPrecisionDate(),
  };

  if (permissionInput.expiresAt) {
    permission.expiresAt = getLowPrecisionDate(permissionInput.expiresAt);
  }

  const json = stringify(permission);
  const signature = await window.crypto.subtle.sign(
    UserKeyAlgorithm,
    identity.privateKey,
    new TextEncoder().encode(json),
  );

  const cert = {
    signature: bytesToBase64(signature),
    authority: { authorityKind, id: identity.id },
  };

  const finalPermission = { ...permission, cert };

  return finalPermission;
}

export async function verifyPermissionSignature(
  permission: Permission,
  identity: Identity,
): Promise<boolean> {
  const { cert, ...permissionData } = permission;

  if (cert.authority.id !== identity.id) {
    return false;
  }

  const now = getLowPrecisionDate();
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
    UserKeyAlgorithm,
    identity.publicKey,
    base64ToBytes(cert.signature),
    new TextEncoder().encode(json),
  );

  return valid;
}

export function matchPermission(
  permission: Permission,
  action: Action,
): boolean {
  if (!matchPermKey([action.deviceId], permission.deviceId)) return false;
  if (!matchPermKey([action.userId], permission.userId)) return false;
  if (!matchPermKey(action.resourceId, permission.resourceId)) return false;
  if (!matchPermKey(action.actionId, permission.actionId)) return false;

  return true;
}

export function matchPermKey(
  key: string[],
  permMatcher: PermissionMatcher,
): boolean {
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

        return true;
      }
    }
  }

  if (matcherIndex < key.length) {
    return false;
  }

  return true;
}

// This is necessary because... something. When being serialized,
// for some reason the milliseconds field is sometimes lost,
// causing mis-certs.
function getLowPrecisionDate(
  ...params: ConstructorParameters<typeof Date> | []
): Date {
  const date = params.length ? new Date() : new Date(...params);
  date.setMilliseconds(0);

  return date;
}

export class PermissionCache {
  private readonly inMemoryCache: Map<string, Permission> = new Map();
  private readonly persistentStore: IndexedDbStore<Permission>;
  private readonly cacheHydration: Promise<Map<string, Permission>>;

  readonly observable: Observable;
  private readonly pushUpdate: () => void;

  private _updateCouner = 0;

  // TODO: save user ID and device ID here
  constructor(
    dbName: string = "webb-tools",
    storeName: string = "PermissionCache",
  ) {
    const persistentStore = new IndexedDbStore<Permission>(dbName, storeName);
    this.persistentStore = persistentStore;
    this.cacheHydration = (async () => {
      for await (const [, permission] of persistentStore) {
        this.inMemoryCache.set(permission.cert.signature, permission);
      }

      return this.inMemoryCache;
    })();

    [this.pushUpdate, this.observable] = Observable.create();
  }

  get updateCounter() {
    return this._updateCouner;
  }

  addPermission(permission: Permission) {
    this.inMemoryCache.set(permission.cert.signature, permission);
    this.persistentStore.setValue([permission.cert.signature], permission);
    this.pushUpdate();
    this._updateCouner += 1;
  }

  async createPermission(
    permissionInput: Omit<Permission, "cert" | "createdAt">,
    authorityKind: Authority["authorityKind"],
    identity: RootIdentity,
  ) {
    const cache = await this.cacheHydration;
    for (const permission of cache.values()) {
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

    this.addPermission(finalPermission);

    return finalPermission;
  }

  async findPermission(action: Action) {
    const cache = await this.cacheHydration;
    for (const permission of cache.values()) {
      if (matchPermission(permission, action)) return permission;
    }

    return undefined;
  }

  async verifyPermissions(
    permission: Permission,
    action: Action,
    identity: Identity,
  ): Promise<PermissionResult> {
    const cache = await this.cacheHydration;
    const { cert } = permission;
    const previousPermission = cache.get(cert.signature);
    if (
      !previousPermission ||
      !isEqual(previousPermission.cert, permission.cert)
    ) {
      const valid = await verifyPermissionSignature(permission, identity);
      if (!valid) return PermissionResult.CertFailure;

      cache.set(permission.cert.signature, permission);
      this.persistentStore.setValue([permission.cert.signature], permission);
    }

    if (!matchPermission(permission, action))
      return PermissionResult.MatchFailure;

    if (!permission.allow) return PermissionResult.Reject;
    return PermissionResult.Allow;
  }
}
