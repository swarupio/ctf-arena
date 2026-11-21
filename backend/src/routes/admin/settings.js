import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit } from '../../services/adminAudit.js';
import { getSettings, settingsBody, updateSettings } from '../../services/adminSettings.js';
import { validate } from '../challenges.js';

const router = Router();

router.use(auth, requireRole('admin'));

router.get('/', async (req, res) => {
  res.json(await getSettings());
});

// Partial update: send only the settings to change.
router.put('/', async (req, res) => {
  const patch = validate(settingsBody, req.body);
  const before = await getSettings();
  const after = await updateSettings(patch, req.user.email);
  await recordAudit(req, { action: 'settings.update', targetType: 'settings', targetId: 'platform', before, after });
  res.json(after);
});

export default router;
