import stringify from "fast-json-stable-stringify";
import { v4 as uuid } from "uuid";

// RSA-PSS-based lock to prevent unauthorized usage of a resource.
export interface PermissionLock {
  __typename: "PermLock";
  id: string;
  publicKey: CryptoKey;
  secret?: {
    privateKey: CryptoKey;
  };
}

export interface PermissionKey {
  __typename: "PermKey";
  lockId: string;
  keyId: string;
  deviceId: string;
  expirationDate: Date;
  base64Signature: string;
}

export class Permissions {
  static async unlock(
    lock: PermissionLock,
    key: PermissionKey,
  ): Promise<boolean> {
    const { base64Signature, ...permKeyData } = key;
    const valid = await window.crypto.subtle.verify(
      { name: "RSA-PSS", saltLength: 32 },
      lock.publicKey,
      base64ToBytes(base64Signature),
      new TextEncoder().encode(stringify(permKeyData)),
    );

    return valid;
  }

  static async createKey(
    deviceId: string,
    lock: Required<PermissionLock>,
  ): Promise<PermissionKey> {
    const expirationDate = new Date();
    expirationDate.setFullYear(new Date().getFullYear() + 1);
    const permKey: Omit<PermissionKey, "base64Signature"> = {
      __typename: "PermKey",
      lockId: lock.id,
      keyId: uuid(),
      deviceId,
      expirationDate,
    };

    const signature = await window.crypto.subtle.sign(
      { name: "RSA-PSS", saltLength: 32 },
      lock.secret.privateKey,
      new TextEncoder().encode(stringify(permKey)),
    );

    return {
      ...permKey,
      base64Signature: bytesToBase64(signature),
    };
  }

  static async hashLockKey(key: CryptoKey): Promise<string> {
    const publicKeyJSON = await window.crypto.subtle.exportKey("jwk", key);

    const publicKeyString = stringify(publicKeyJSON);

    const publicKeyBytes = new TextEncoder().encode(publicKeyString);

    const publicIdBytes = await window.crypto.subtle.digest(
      "SHA-1",
      publicKeyBytes,
    );

    const publicId = bytesToBase64(publicIdBytes);

    return publicId;
  }

  static async createLock(): Promise<Required<PermissionLock>> {
    const authKeyPair = await window.crypto.subtle.generateKey(
      {
        name: "RSA-PSS",
        modulusLength: 4096,
        hash: "SHA-256",
        // https://developer.mozilla.org/en-US/docs/Web/API/RsaHashedKeyGenParams#publicexponent
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      },
      true,
      ["sign", "verify"],
    );

    const id = await this.hashLockKey(authKeyPair.publicKey);

    return {
      __typename: "PermLock",
      id,
      publicKey: authKeyPair.publicKey,
      secret: {
        privateKey: authKeyPair.privateKey,
      },
    };
  }
}

// Requirements
// 1. State things about a device as verifiable fact - device ID + PK encrypt
// 2. State things about a user as verifiable fact - user ID + PK encrypt
// 3. Hide information from disk reads - symmetric encryption at rest per-note
// 4. Wrap encryption key for each note using user's public key
export function getKey() {}

export interface UserKeys {
  // Using RSA-PSS
  publicAuthUserId: string;
  publicAuthKey: CryptoKey;
  privateAuthKey: CryptoKey;

  // Using AES-GCM
  privateEncryptKey: CryptoKey;
}

export function base64ToBytes(base64: string): ArrayBuffer {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
}

export function bytesToBase64(bytes: ArrayBuffer): string {
  const binString = Array.from(new Uint8Array(bytes), (byte) =>
    String.fromCodePoint(byte),
  ).join("");
  return btoa(binString);
}

export async function importUserPublicKey(keyData: unknown) {
  const key = await window.crypto.subtle.importKey(
    "jwk",
    keyData as any,
    {
      name: "RSA-PSS",
      hash: "SHA-512",
    },
    true,
    ["verify"],
  );

  return key;
}

export async function exportUserPublickKey(key: CryptoKey) {
  const keyJwk = await window.crypto.subtle.exportKey("jwk", key);

  return keyJwk;
}

export async function createUserKeys(): Promise<UserKeys> {
  const authKeyPair = await window.crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 4096,
      hash: "SHA-512",
      // https://developer.mozilla.org/en-US/docs/Web/API/RsaHashedKeyGenParams#publicexponent
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    },
    true,
    ["sign", "verify"],
  );

  const encrypt = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );

  const publicId = await getUserIdFromPublicKey(authKeyPair.publicKey);

  return {
    publicAuthUserId: publicId,
    publicAuthKey: authKeyPair.publicKey,
    privateAuthKey: authKeyPair.privateKey,
    privateEncryptKey: encrypt,
  };
}

export async function verifyUserKey(
  key: CryptoKey,
  userId: string,
): Promise<boolean> {
  if (key.algorithm.name !== "RSA-PSS") {
    return false;
  }

  return userId === (await getUserIdFromPublicKey(key));
}

export async function getUserIdFromPublicKey(key: CryptoKey): Promise<string> {
  const publicKeyJSON = await window.crypto.subtle.exportKey("jwk", key);

  const publicKeyString = stringify(publicKeyJSON);

  const publicKeyBytes = new TextEncoder().encode(publicKeyString);

  const publicIdBytes = await window.crypto.subtle.digest(
    "SHA-256",
    publicKeyBytes,
  );

  const publicId = bytesToBase64(publicIdBytes);

  return publicId;
}

/*

Public-key encryption:
  const encryptPair = await window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 4096,
      hash: "SHA-512",
      // https://developer.mozilla.org/en-US/docs/Web/API/RsaHashedKeyGenParams#publicexponent
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );

 */
