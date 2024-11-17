// TODO: make this work in Node.js as well

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

export const UserKeyAlgorithm = {
  name: "RSA-PSS",
  hash: "SHA-512",
  modulusLength: 4096,
  saltLength: 32,

  // https://developer.mozilla.org/en-US/docs/Web/API/RsaHashedKeyGenParams#publicexponent
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
} as const;

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
