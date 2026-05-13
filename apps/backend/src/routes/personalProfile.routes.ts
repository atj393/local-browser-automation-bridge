import { Router } from 'express';
import { z } from 'zod';
import type { UpdatePersonalProfileRequest } from '@lbab/shared';
import { personalProfileService } from '../services/personalProfileService.js';
import { logService } from '../services/logService.js';

export const personalProfileRouter = Router();

const stringArray = z.array(z.string()).max(100).optional();

const toneSchema = z
  .object({
    primary: stringArray,
    avoid: stringArray,
  })
  .optional();

const hashtagsSchema = z
  .object({
    enabled: z.boolean().optional(),
    min: z.number().int().min(0).max(5).optional(),
    max: z.number().int().min(0).max(5).optional(),
    preferred: stringArray,
    avoid: stringArray,
  })
  .optional();

const profileSchema = z
  .object({
    whoAmI: z.string().max(2000).optional(),
    shortBio: z.string().max(1000).optional(),
    likes: stringArray,
    dislikes: stringArray,
    avoidTopics: stringArray,
    tone: toneSchema,
    geographicPreferences: stringArray,
    topicInterests: stringArray,
    values: stringArray,
    writingRules: stringArray,
    hashtagPreferences: hashtagsSchema,
    languagePreference: z.string().max(60).optional(),
    customInstructions: z.string().max(4000).optional(),
    safetyRules: stringArray,
  })
  .optional();

const updateSchema = z.object({
  isEnabled: z.boolean().optional(),
  profile: profileSchema,
});

personalProfileRouter.get('/api/personal-profile', (_req, res) => {
  res.json(personalProfileService.get());
});

personalProfileRouter.put('/api/personal-profile', (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
  }
  try {
    // Zod inference produces deeper-partial types than `Partial<PersonalProfile>`;
    // the service normalizes every field so the runtime contract holds.
    const updated = personalProfileService.update(
      parsed.data as UpdatePersonalProfileRequest,
    );
    logService.info('Personal profile updated.', { isEnabled: updated.isEnabled });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

personalProfileRouter.post('/api/personal-profile/reset', (_req, res) => {
  const reset = personalProfileService.reset();
  logService.info('Personal profile reset.');
  res.json(reset);
});
