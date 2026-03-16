import { Router } from "express";
import requireAuth from "../middleware/auth.js";
import authRouter from "./auth.js";
import deployRouter from "./deploy.js";

const router = Router();

router.use("/", authRouter);
router.use("/", requireAuth, deployRouter);

export default router;
