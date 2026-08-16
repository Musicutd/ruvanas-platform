import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const raw = process.env.SECRET_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY is not set. Generate a 32-byte hex key and set it as an environment variable."
    );
  }

  const key = Buffer.from(raw, "hex");

  if (key.length !== 32) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)."
    );
  }

  return key;
}

export function encryptSecret(plainText) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex")
  ].join(":");
}

export function decryptSecret(stored) {
  const key = getKey();
  const [ivHex, authTagHex, encryptedHex] = stored.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}
