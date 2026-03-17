import { Router } from "express";
import { addEnvironment, removeEnvironment } from "../controllers/envController.js";

const router = Router();

router.post("/environments", addEnvironment);
router.delete("/environments/:envId", removeEnvironment);

export default router;
