import { Router } from "express";
import requireAuth from "../middleware/auth.js";
import { startRelease, getReleaseStatus, getReleaseLog } from "../controllers/playStoreController.js";

const router = Router();

router.post("/play-store/release", requireAuth, startRelease);
router.get("/play-store/status", requireAuth, getReleaseStatus);
router.get("/play-store/log", requireAuth, getReleaseLog);

export default router;
