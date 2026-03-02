import { AnyZodObject } from "zod";
import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/appError";

export const validate = (schema: AnyZodObject) => (req: Request, _res: Response, next: NextFunction) => {
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

    const message =
      issues
        .map((issue) => `${issue.path || "request"}: ${issue.message}`)
        .join("; ")
        .trim() || "Validation failed";

    return next(new AppError(message, 422, issues));
  }

  req.body = parsed.data.body;
  req.query = parsed.data.query as Request["query"];
  req.params = parsed.data.params as Request["params"];

  next();
};
