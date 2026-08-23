import { S3Client } from "@aws-sdk/client-s3";

const requiredEnvironmentVariables = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT"
];

function getR2Environment() {
  const missing = requiredEnvironmentVariables.filter(
    (name) => !process.env[name]
  );

  if (missing.length > 0) {
    throw new Error(
      `Cloudflare R2 is not configured. Missing environment variables: ${missing.join(
        ", "
      )}`
    );
  }

  return {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME,
    endpoint: process.env.R2_ENDPOINT
  };
}

const r2Environment = getR2Environment();

export const r2Client = new S3Client({
  region: "auto",
  endpoint: r2Environment.endpoint,
  credentials: {
    accessKeyId: r2Environment.accessKeyId,
    secretAccessKey: r2Environment.secretAccessKey
  },
  forcePathStyle: true
});

export const r2BucketName = r2Environment.bucketName;
