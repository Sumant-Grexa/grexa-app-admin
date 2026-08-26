import { Router } from "express";
import {
  getTestStagingModules,
  getTestStagingStates,
  startTestStaging,
  getTestStagingLog,
} from "../controllers/testStagingController.js";

const router = Router();

router.get("/test-staging/modules", getTestStagingModules);
router.get("/test-staging/states", getTestStagingStates);
router.post("/test-staging/start", startTestStaging);
router.get("/test-staging/log", getTestStagingLog);

export default router;
