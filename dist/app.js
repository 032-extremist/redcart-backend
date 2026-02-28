"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const env_1 = require("./config/env");
const routes_1 = __importDefault(require("./routes"));
const error_1 = require("./middleware/error");
exports.app = (0, express_1.default)();
const allowedOrigins = env_1.env.CLIENT_URL.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
if (env_1.env.NODE_ENV === "production") {
    exports.app.set("trust proxy", 1);
}
exports.app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    exposedHeaders: ["X-Receipt-Email-Status", "X-Receipt-Email-Reason", "X-Receipt-Email-Message-Id"],
}));
exports.app.use((0, helmet_1.default)());
exports.app.use(express_1.default.json({ limit: "1mb" }));
exports.app.use((0, cookie_parser_1.default)());
exports.app.use((0, morgan_1.default)(env_1.env.NODE_ENV === "production" ? "combined" : "dev"));
exports.app.use("/uploads", express_1.default.static(path_1.default.resolve(process.cwd(), "uploads")));
exports.app.use("/api", (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
}));
exports.app.get("/", (_req, res) => {
    res.json({
        service: "RedCart API",
        health: "/api/v1/health",
        docsHint: "All API routes are under /api/v1",
    });
});
exports.app.get("/health", (_req, res) => {
    res.redirect(307, "/api/v1/health");
});
exports.app.use("/api", routes_1.default);
exports.app.use("/api/v1", routes_1.default);
exports.app.use(error_1.notFoundHandler);
exports.app.use(error_1.errorHandler);
