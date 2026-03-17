import { Router } from "express";
import requireAuth from "../middleware/auth.js";
import authRouter from "./auth.js";
import deployRouter from "./deploy.js";
import envRouter from "./environments.js";

const router = Router();

router.use("/", authRouter);
router.use("/", requireAuth, deployRouter);
router.use("/", requireAuth, envRouter);

export default router;
