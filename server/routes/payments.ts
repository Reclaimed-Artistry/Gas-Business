import { Router } from 'express';

// No real gateway integration exists yet. Never accept payment instructions or
// webhooks until initialization and independent verification are implemented.
const router = Router();
router.use((_req, res) => {
  res.status(503).json({ error: 'Online payments and wallet funding are temporarily unavailable.' });
});
export default router;
