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
    const message = parsed.error.issues.map((issue) => issue.message).join(", ");
    return next(new AppError(message || "Validation failed", 422));
  }

  req.body = parsed.data.body;
  req.query = parsed.data.query as Request["query"];
  req.params = parsed.data.params as Request["params"];

  next();
};
