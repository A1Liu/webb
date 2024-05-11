import stringify from "fast-json-stable-stringify";
import { base64ToBytes, bytesToBase64 } from "./util";

export const UserKeyAlgorithm = {
  name: "RSA-PSS",
  hash: "SHA-512",
  modulusLength: 4096,
  saltLength: 32,

  // https://developer.mozilla.org/en-US/docs/Web/API/RsaHashedKeyGenParams#publicexponent
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
} as const;

interface UserKeys {
  // Using RSA-PSS
  publicAuthUserId: string;
  publicAuthKey: CryptoKey;
  privateAuthKey: CryptoKey;
}

export async function importUserPublicKey(keyData: string): Promise<CryptoKey> {
  const key = await window.crypto.subtle.importKey(
    "spki",
    base64ToBytes(keyData),
    UserKeyAlgorithm,
    true,
    ["verify"],
  );

  return key;
}

export async function exportUserPublickKey(key: CryptoKey): Promise<string> {
  const keyBytes = await window.crypto.subtle.exportKey("spki", key);

  return bytesToBase64(keyBytes);
}

export async function createUserKeys(): Promise<UserKeys> {
  const authKeyPair = await window.crypto.subtle.generateKey(
    UserKeyAlgorithm,
    true,
    ["sign", "verify"],
  );

  const publicId = await getUserIdFromPublicKey(authKeyPair.publicKey);

  return {
    publicAuthUserId: publicId,
    publicAuthKey: authKeyPair.publicKey,
    privateAuthKey: authKeyPair.privateKey,
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
