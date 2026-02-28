"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
process.env.PRISMA_CLIENT_ENGINE_TYPE = "library";
exports.prisma = new client_1.PrismaClient();
