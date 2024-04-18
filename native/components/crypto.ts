export interface EncryptedTextData {
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
