import { Router } from 'express';
import healthRoutes from './health.routes';
import analysisRoutesV1 from './v1/analysis.routes';

const router = Router();

// Unversioned root & health endpoints
router.use('/', healthRoutes);

// Versioned API v1 endpoints
router.use('/api/v1', analysisRoutesV1);

export default router;
