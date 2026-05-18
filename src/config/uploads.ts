import path from "path";

const isServerlessRuntime =
  process.env.NETLIFY === "true" ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

export const uploadsRoot = isServerlessRuntime
  ? path.join("/tmp", "redcart-uploads")
  : path.resolve(process.cwd(), "uploads");

export const productUploadsDir = path.join(uploadsRoot, "products");

