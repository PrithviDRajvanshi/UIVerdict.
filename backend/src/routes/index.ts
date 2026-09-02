import { Router } from 'express';
import healthRoutes from './health.routes';
import analysisRoutesV1 from './v1/analysis.routes';
import authRoutesV1 from './v1/auth.routes';
import archiveRoutesV1 from './v1/archive.routes';

const router = Router();

// Unversioned root & health endpoints
router.use('/', healthRoutes);

// Versioned API v1 endpoints
router.use('/api/v1/auth', authRoutesV1);
router.use('/api/v1', analysisRoutesV1);
router.use('/api/v1', archiveRoutesV1);

export default router;
