import { Router, type IRouter } from "express";
import healthRouter from "./health";
import casesRouter from "./cases";

const router: IRouter = Router();

router.use(healthRouter);
router.use(casesRouter);

export default router;
