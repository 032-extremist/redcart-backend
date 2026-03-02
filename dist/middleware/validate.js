"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
const appError_1 = require("../utils/appError");
const validate = (schema) => (req, _res, next) => {
    const parsed = schema.safeParse({
        body: req.body ?? {},
        query: req.query ?? {},
        params: req.params ?? {},
    });
    if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => {
            const path = issue.path.join(".");
            return {
                path,
                message: issue.message,
            };
        });
        const message = issues
            .map((issue) => `${issue.path || "request"}: ${issue.message}`)
            .join("; ")
            .trim() || "Validation failed";
        return next(new appError_1.AppError(message, 422, issues));
    }
    req.body = parsed.data.body;
    req.query = parsed.data.query;
    req.params = parsed.data.params;
    next();
};
exports.validate = validate;
