import { Router } from 'express';
import { getArchiveAnalyses, getReportById } from '../../controllers/archive.controller';
import { authMiddleware, optionalAuthMiddleware } from '../../middleware/auth.middleware';

const router = Router();

router.get('/analyses', authMiddleware, getArchiveAnalyses);
router.get('/reports/:analysisId', optionalAuthMiddleware, getReportById);

export default router;
