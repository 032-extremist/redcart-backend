import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "../config/env";

type TokenPayload = {
  userId: string;
  role: Role;
};

export const signJwt = (payload: TokenPayload) =>
  jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

export const verifyJwt = (token: string) =>
  jwt.verify(token, env.JWT_SECRET) as TokenPayload;
