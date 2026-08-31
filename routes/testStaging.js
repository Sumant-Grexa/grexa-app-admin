import { Router } from "express";
import {
  getTestStagingModules,
  startTestStaging,
  getTestStagingLog,
} from "../controllers/testStagingController.js";

const router = Router();

router.get("/test-staging/modules", getTestStagingModules);
router.post("/test-staging/start", startTestStaging);
router.get("/test-staging/log", getTestStagingLog);

export default router;
