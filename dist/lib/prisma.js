"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
// Force local query engine mode for this project.
// This prevents accidental fallback to the remote/accelerate engine path,
// which expects prisma:// URLs and causes P6001 on normal postgresql:// URLs.
process.env.PRISMA_CLIENT_ENGINE_TYPE = "library";
exports.prisma = new client_1.PrismaClient();
