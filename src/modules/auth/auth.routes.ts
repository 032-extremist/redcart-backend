import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import { signJwt } from "../../utils/jwt";
import { authenticate } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";

const router = Router();

const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z
      .string()
      .min(8)
      .regex(/[A-Z]/, "Password must include an uppercase letter")
      .regex(/[0-9]/, "Password must include a number"),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    phone: z.string().optional(),
  }),
  query: z.object({}),
  params: z.object({}),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  query: z.object({}),
  params: z.object({}),
});

const passwordResetRequestSchema = z.object({
  body: z.object({ email: z.string().email() }),
  query: z.object({}),
  params: z.object({}),
});

const passwordResetConfirmSchema = z.object({
  body: z.object({
    email: z.string().email(),
    newPassword: z
      .string()
      .min(8)
      .regex(/[A-Z]/, "Password must include an uppercase letter")
      .regex(/[0-9]/, "Password must include a number"),
  }),
  query: z.object({}),
  params: z.object({}),
});

router.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError("Email is already in use", 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const csrfToken = crypto.randomBytes(24).toString("hex");

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        phone,
        csrfToken,
        cart: { create: {} },
      },
    });

    const token = signJwt({ userId: user.id, role: user.role });

    res.status(201).json({
      token,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError("Invalid credentials", 401);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AppError("Invalid credentials", 401);
    }

    const csrfToken = crypto.randomBytes(24).toString("hex");

    await prisma.user.update({
      where: { id: user.id },
      data: { csrfToken },
    });

    const token = signJwt({ userId: user.id, role: user.role });

    res.json({
      token,
      csrfToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        createdAt: true,
        csrfToken: true,
      },
    });

    if (!user) {
      throw new AppError("User not found", 404);
    }

    const csrfToken = user.csrfToken ?? crypto.randomBytes(24).toString("hex");

    if (!user.csrfToken) {
      await prisma.user.update({
        where: { id: user.id },
        data: { csrfToken },
      });
    }

    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt,
      csrfToken,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", authenticate, requireCsrf, async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.auth!.userId },
      data: { csrfToken: null },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post(
  "/password-reset/request",
  validate(passwordResetRequestSchema),
  async (req, res, next) => {
    try {
      const { email } = req.body;
      const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });

      res.json({
        message: "If the email exists, a reset instruction has been queued.",
        queued: Boolean(exists),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/password-reset/confirm",
  validate(passwordResetConfirmSchema),
  async (req, res, next) => {
    try {
      const { email, newPassword } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      res.json({ message: "Password has been reset" });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
