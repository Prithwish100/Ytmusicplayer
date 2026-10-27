import { Router, type IRouter } from "express";
import healthRouter from "./health";
import favoritesRouter from "./favorites";
import musicRouter from "./music";

const router: IRouter = Router();

router.use(healthRouter);
router.use(musicRouter);
router.use(favoritesRouter);

export default router;
