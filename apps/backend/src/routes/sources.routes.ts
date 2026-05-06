import { Router } from 'express';
import { z } from 'zod';
import { sourceService } from '../services/sourceService.js';

export const sourcesRouter = Router();

const testSchema = z.object({
  url: z.string().min(1),
});

sourcesRouter.post('/api/sources/test', async (req, res) => {
  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() });
  }
  const allowed = sourceService.isAllowedSourceUrl(parsed.data.url);
  if (!allowed.ok) {
    return res.status(400).json({ ok: false, error: allowed.reason });
  }
  try {
    const ctx = await sourceService.fetchAndExtractSource(parsed.data.url);
    if (!ctx.text || ctx.text.length === 0) {
      return res.status(200).json({
        ok: false,
        url: ctx.url,
        finalUrl: ctx.finalUrl,
        method: ctx.method,
        contentType: ctx.contentType,
        status: ctx.status,
        size: ctx.size,
        extractedLength: 0,
        preview: '',
        error: 'No usable content extracted.',
      });
    }
    return res.json({
      ok: true,
      url: ctx.url,
      finalUrl: ctx.finalUrl,
      method: ctx.method,
      contentType: ctx.contentType,
      status: ctx.status,
      size: ctx.size,
      title: ctx.title,
      extractedLength: ctx.text.length,
      preview: ctx.preview,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error });
  }
});
