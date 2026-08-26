import { Router } from "express";
import requireAuth from "../middleware/auth.js";
import authRouter from "./auth.js";
import deployRouter from "./deploy.js";
import envRouter from "./environments.js";
import playStoreRouter from "./playStore.js";
import testStagingRouter from "./testStaging.js";

const router = Router();

router.use("/", authRouter);
router.use("/", requireAuth, deployRouter);
router.use("/", requireAuth, envRouter);
router.use("/", requireAuth, testStagingRouter);
router.use("/", playStoreRouter);

export default router;
