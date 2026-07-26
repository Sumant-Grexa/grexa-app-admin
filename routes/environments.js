import { Router } from "express";
import { addEnvironment, removeEnvironment } from "../controllers/envController.js";
import {
  readEnvVars,
  writeEnvVars,
  syncEnvVarsBySourceDestination,
  startSyncEnvVarsTask,
  getSyncEnvVarsTaskStatus,
} from "../controllers/envVarsController.js";

const router = Router();

router.post("/environments", addEnvironment);
router.delete("/environments/:envId", removeEnvironment);
router.post("/environments/env-vars/sync-one", syncEnvVarsBySourceDestination);
router.post("/environments/env-vars/sync-one/start", startSyncEnvVarsTask);
router.get("/environments/env-vars/sync-one/status/:taskId", getSyncEnvVarsTaskStatus);
router.post("/environments/:envId/env-vars/read", readEnvVars);
router.post("/environments/:envId/env-vars/write", writeEnvVars);

export default router;
