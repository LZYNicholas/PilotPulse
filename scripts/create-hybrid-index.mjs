import { existsSync, readFileSync } from "node:fs";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;

  const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);

  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    process.env[key] ??= value;
  }
}

loadLocalEnv();

const PINECONE_API_VERSION = "2025-10";

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

async function getIndex(indexName) {
  const response = await fetch(
    `https://api.pinecone.io/indexes/${encodeURIComponent(indexName)}`,
    {
      headers: {
        "Api-Key": requireEnv("PINECONE_API_KEY"),
        "X-Pinecone-Api-Version": PINECONE_API_VERSION,
      },
    },
  );

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`Failed to describe Pinecone index: ${await response.text()}`);
  }

  return response.json();
}

async function createIndex({
  name,
  dimension,
  cloud,
  region,
}) {
  const response = await fetch("https://api.pinecone.io/indexes", {
    method: "POST",
    headers: {
      "Api-Key": requireEnv("PINECONE_API_KEY"),
      "Content-Type": "application/json",
      "X-Pinecone-Api-Version": PINECONE_API_VERSION,
    },
    body: JSON.stringify({
      name,
      vector_type: "dense",
      dimension,
      metric: "dotproduct",
      spec: {
        serverless: {
          cloud,
          region,
        },
      },
      deletion_protection: "disabled",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create Pinecone index: ${await response.text()}`);
  }

  return response.json();
}

async function main() {
  const sourceIndexName = requireEnv("PINECONE_INDEX_NAME");
  const targetIndexName =
    process.env.PINECONE_HYBRID_INDEX_NAME ?? `${sourceIndexName}-hybrid`;

  const sourceIndex = await getIndex(sourceIndexName);

  if (!sourceIndex) {
    throw new Error(`Source index ${sourceIndexName} does not exist.`);
  }

  const existingTargetIndex = await getIndex(targetIndexName);

  if (existingTargetIndex) {
    console.log(
      `Hybrid index ${targetIndexName} already exists with metric ${existingTargetIndex.metric}.`,
    );
    return;
  }

  const cloud =
    process.env.PINECONE_CLOUD ?? sourceIndex.spec?.serverless?.cloud;
  const region =
    process.env.PINECONE_REGION ?? sourceIndex.spec?.serverless?.region;

  if (!cloud || !region) {
    throw new Error(
      "Could not determine Pinecone cloud/region. Set PINECONE_CLOUD and PINECONE_REGION.",
    );
  }

  await createIndex({
    name: targetIndexName,
    dimension: sourceIndex.dimension,
    cloud,
    region,
  });

  console.log(
    `Created hybrid Pinecone index ${targetIndexName} in ${cloud}/${region} with dotproduct metric.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
