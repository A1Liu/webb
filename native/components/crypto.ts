import stringify from "fast-json-stable-stringify";

export interface AesGcmEncryptedTextData {
  __typename: "EncryptedText";
  iv: number[];
  wrappedEncryptionKey: string;

  // base64 encoded
  encryptedData: string;
}

// Requirements
// 1. State things about a device as verifiable fact - device ID + PK encrypt
// 2. State things about a user as verifiable fact - user ID + PK encrypt
// 3. Hide information from disk reads - symmetric encryption at rest per-note
// 4. Wrap encryption key for each note using user's public key
export function getKey() {}

export class EncryptedText {
  private _text: string = "";
  private encrypted: boolean = false;
  private rawEncryptionKey: CryptoKey | undefined = undefined;
  private wrappedEncryptionKey: string;
  private readonly iv: ArrayBuffer;

  constructor(options: { wrappedEncryptionKey: string; iv?: ArrayBuffer }) {
    this.wrappedEncryptionKey = options.wrappedEncryptionKey;
    this.iv = options.iv ?? window.crypto.getRandomValues(new Uint8Array(12));
  }

  decryptKey(runner: (wrapped: string) => CryptoKey) {
    this.rawEncryptionKey = runner(this.wrappedEncryptionKey);
  }

  async decryptText() {
    if (!this.encrypted) {
      return;
    }

    if (!this.rawEncryptionKey) {
      throw new Error("Don't have the encryption key unwrapped yet");
    }

    const output = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: this.iv },
      this.rawEncryptionKey,
      new TextEncoder().encode(this._text)
    );

    this._text = new TextDecoder().decode(output);
  }

  set text(value: string) {
    if (this.encrypted) {
      throw new Error("Can't modify the data until it's decrypted");
    }

    this._text = value;
  }

  get text(): string {
    if (this.encrypted) {
      throw new Error("Can't modify the data until it's decrypted");
    }

    return this._text;
  }
}

export interface UserKeys {
  // Using RSA-PSS
  publicAuthUserId: string;
  publicAuthKey: CryptoKey;
  privateAuthKey: CryptoKey;

  // Using AES-GCM
  privateEncryptKey: CryptoKey;
}

function bytesToBase64(bytes: ArrayBuffer) {
  const binString = Array.from(new Uint8Array(bytes), (byte) =>
    String.fromCodePoint(byte)
  ).join("");
  return btoa(binString);
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
    ["sign", "verify"]
  );

  const encrypt = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
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
  userId: string
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
    publicKeyBytes
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
