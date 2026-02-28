#!/usr/bin/env node

"use strict";

const admin = require("firebase-admin");
const { loadEnvFromCandidates } = require("./load_env");

loadEnvFromCandidates();

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

async function main() {
  const credentialsPath = requireEnv("GOOGLE_APPLICATION_CREDENTIALS");
  const bucketName = requireEnv("CODEX_MEMO_FIREBASE_BUCKET");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      storageBucket: bucketName
    });
  }

  const bucket = admin.storage().bucket(bucketName);
  const [metadata] = await bucket.getMetadata();

  console.log(`credentials=${credentialsPath}`);
  console.log(`bucket=${bucket.name}`);
  console.log(`projectNumber=${metadata.projectNumber || "-"}`);
  console.log(`location=${metadata.location || "-"}`);
  console.log(`storageClass=${metadata.storageClass || "-"}`);
  console.log("status=ok");
}

main().catch((err) => {
  console.error("Firebase Storage check failed:", err.message);
  process.exit(1);
});
