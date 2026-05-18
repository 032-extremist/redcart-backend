import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireCsrf } from "../../middleware/csrf";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";

const router = Router();

const updateProfileSchema = z.object({
  body: z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().optional(),
  }),
  query: z.object({}),
  params: z.object({}),
});

router.use(authenticate);

router.get("/profile", async (req, res, next) => {
  try {
    const profile = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });

    res.json(profile);
  } catch (error) {
    next(error);
  }
});

router.patch("/profile", requireCsrf, validate(updateProfileSchema), async (req, res, next) => {
  try {
    const profile = await prisma.user.update({
      where: { id: req.auth!.userId },
      data: req.body,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });

    res.json(profile);
  } catch (error) {
    next(error);
  }
});

export default router;
