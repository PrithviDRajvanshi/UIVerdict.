import { Router } from 'express';
import { analyze } from '../../controllers/analysis.controller';
import { validate } from '../../middleware/validate';
import { analyzeSchema } from '../../validators/analysis.validator';
import { optionalAuthMiddleware } from '../../middleware/auth.middleware';

const router = Router();

router.post('/analyze', optionalAuthMiddleware, validate(analyzeSchema), analyze);

export default router;
