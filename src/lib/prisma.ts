import { PrismaClient } from "@prisma/client";

// Force local query engine mode for this project.
// This prevents accidental fallback to the remote/accelerate engine path,
// which expects prisma:// URLs and causes P6001 on normal postgresql:// URLs.
process.env.PRISMA_CLIENT_ENGINE_TYPE = "library";

export const prisma = new PrismaClient();
