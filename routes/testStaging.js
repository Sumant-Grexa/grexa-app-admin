import { Router } from "express";
import {
  getTestStagingModules,
  getTestStagingPrefs,
  getTestStagingStates,
  setTestStagingSelectedModule,
  startTestStaging,
  getTestStagingLog,
  getTestStagingPlaneRequests,
  clearTestStagingPlaneRequests,
} from "../controllers/testStagingController.js";

const router = Router();

router.get("/test-staging/modules", getTestStagingModules);
router.get("/test-staging/preferences", getTestStagingPrefs);
router.get("/test-staging/states", getTestStagingStates);
router.post("/test-staging/selected-module", setTestStagingSelectedModule);
router.post("/test-staging/start", startTestStaging);
router.get("/test-staging/log", getTestStagingLog);
router.get("/test-staging/plane-requests", getTestStagingPlaneRequests);
router.delete("/test-staging/plane-requests", clearTestStagingPlaneRequests);

export default router;
