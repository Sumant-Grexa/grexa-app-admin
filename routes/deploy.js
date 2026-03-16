import { Router } from "express";
import { getStatus, getEnvBranches, startDeploy, getDeployLog } from "../controllers/deployController.js";

const router = Router();

router.get("/status", getStatus);
router.get("/branches/:envId", getEnvBranches);
router.post("/deploy", startDeploy);
router.get("/deploy-log/:envId", getDeployLog);

export default router;
