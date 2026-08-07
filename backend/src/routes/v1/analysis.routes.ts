import { Router } from 'express';
import { analyze } from '../../controllers/analysis.controller';
import { validate } from '../../middleware/validate';
import { analyzeSchema } from '../../validators/analysis.validator';

const router = Router();

router.post('/analyze', validate(analyzeSchema), analyze);

export default router;
