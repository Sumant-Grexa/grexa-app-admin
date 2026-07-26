import { Router } from "express";
import { addEnvironment, removeEnvironment } from "../controllers/envController.js";
import { readEnvVars, writeEnvVars, syncDevEnvVars } from "../controllers/envVarsController.js";

const router = Router();

router.post("/environments", addEnvironment);
router.delete("/environments/:envId", removeEnvironment);
router.post("/environments/env-vars/sync-dev", syncDevEnvVars);
router.post("/environments/:envId/env-vars/read", readEnvVars);
router.post("/environments/:envId/env-vars/write", writeEnvVars);

export default router;
