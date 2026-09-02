import { Router } from 'express';
import { getArchiveAnalyses } from '../../controllers/archive.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();

router.get('/analyses', authMiddleware, getArchiveAnalyses);

export default router;
