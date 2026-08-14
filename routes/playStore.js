import { Router } from "express";
import requireAuth from "../middleware/auth.js";
import {
  startRelease,
  getReleaseStatus,
  getReleaseLog,
  testBeaconDocsSync,
  triggerBeaconDocsSync,
} from "../controllers/playStoreController.js";

const router = Router();

router.post("/play-store/release", requireAuth, startRelease);
router.get("/play-store/status", requireAuth, getReleaseStatus);
router.get("/play-store/log", requireAuth, getReleaseLog);
router.post("/play-store/test-beacon-docs-sync", requireAuth, testBeaconDocsSync);
router.post("/play-store/beacon-docs-sync", requireAuth, triggerBeaconDocsSync);

export default router;
