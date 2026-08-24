import { S3Client } from "@aws-sdk/client-s3";
import { requireEnvironmentGroup } from "@/lib/environment.mjs";

const requiredEnvironmentVariables = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT"
];

let storage;

export function getR2Storage() {
  if (storage) {
    return storage;
  }

  const environment = requireEnvironmentGroup(
    requiredEnvironmentVariables,
    "Cloudflare R2"
  );

  storage = {
    client: new S3Client({
      region: "auto",
      endpoint: environment.R2_ENDPOINT,
      credentials: {
        accessKeyId: environment.R2_ACCESS_KEY_ID,
        secretAccessKey: environment.R2_SECRET_ACCESS_KEY
      },
      forcePathStyle: true
    }),
    bucketName: environment.R2_BUCKET_NAME
  };

  return storage;
}
