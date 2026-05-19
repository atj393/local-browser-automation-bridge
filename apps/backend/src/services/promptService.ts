import { extensionGateway } from '../websocket/extensionGateway.js';
import { jsonExtractionService } from './jsonExtractionService.js';
import { queueService } from './queueService.js';
import { settingsService } from './settingsService.js';
import { sourceService, type SourceContext } from './sourceService.js';
import { personalProfileService } from './personalProfileService.js';
import { logService } from './logService.js';
import { MAX_CONTENT_LENGTH } from '@lbab/shared';

const PLACEHOLDER_KEYS = [
  '{{batchSize}}',
  '{{postsPerGeneration}}',
  '{{sourceContext}}',
  '{{sourceUrl}}',
  '{{categoryName}}',
  '{{personalProfile}}',
  '{{date}}',
];

const PERSONAL_PROFILE_RULES = `Rules for using the personal profile:
- Use the profile as writing guidance, not as facts to repeat verbatim.
- Align topic framing with the profile when relevant.
- Do not force personal views into unrelated topics.
- Do not attack religious, ethnic, caste, nationality, gender, or other protected groups.
- If avoided topics are listed, avoid those topics unless the source is specifically about them and a neutral factual mention is necessary.
- Maintain the requested tone.
- Keep posts natural and personal, not robotic.`;

function buildSourceContextBlock(ctx: SourceContext): string {
  if (!ctx.url) {
    return '(No source provided; please use the fallback topic.)';
  }
  if (!ctx.text || ctx.text.length === 0) {
    return `(Source URL ${ctx.url} returned no usable content; please use the fallback topic.)`;
  }
  const lines: string[] = [];
  lines.push(`Source extraction method: ${ctx.method}`);
  lines.push('');
  lines.push(ctx.text);
  if (ctx.method === 'homepage-links') {
    lines.push('');
    lines.push(
      'Create posts based on the themes and headlines above. Do not invent specific facts beyond what is provided.',
    );
  }
  return lines.join('\n');
}

function buildPrompt(
  template: string,
  postsPerGeneration: number,
  ctx: SourceContext,
  personalProfile: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const sourceUrl = ctx.url ?? '(none)';
  const sourceContext = buildSourceContextBlock(ctx);
  const categoryName = ctx.categoryName ?? '(uncategorized)';
  // When the profile is disabled or empty we still substitute the
  // placeholder so the template does not show literal `{{personalProfile}}`.
  const profileBlock = personalProfile.trim().length
    ? personalProfile.trim()
    : '(No personal profile provided.)';

  const replaced = template
    .replaceAll('{{batchSize}}', String(postsPerGeneration))
    .replaceAll('{{postsPerGeneration}}', String(postsPerGeneration))
    .replaceAll('{{sourceUrl}}', sourceUrl)
    .replaceAll('{{sourceContext}}', sourceContext)
    .replaceAll('{{categoryName}}', categoryName)
    .replaceAll('{{personalProfile}}', profileBlock)
    .replaceAll('{{date}}', today);

  const hasAnyPlaceholder = PLACEHOLDER_KEYS.some((k) => template.includes(k));
  let body = hasAnyPlaceholder
    ? replaced
    : `${replaced.trimEnd()}

---
Generation count: ${postsPerGeneration}
Selected source URL: ${sourceUrl}
Source/context:
${sourceContext}

Return valid JSON only.`;

  // If the template never referenced {{personalProfile}} but we DO have a
  // profile to apply, append it. This keeps existing custom prompts
  // working without forcing users to edit their template.
  if (personalProfile.trim().length && !template.includes('{{personalProfile}}')) {
    body = `${body.trimEnd()}

---
${profileBlock}

${PERSONAL_PROFILE_RULES}`;
  }

  return body;
}

export interface CleanedItem {
  content: string;
  raw: unknown;
}

function cleanItemContent(raw: string): string {
  let s = raw.trim();
  // Strip surrounding matching quotes.
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  // Drop any leading list numbering like "1) " or "1. "
  s = s.replace(/^\s*\d+[.)]\s+/, '');
  // Collapse internal runs of whitespace.
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * Trim, dedupe, and length-cap a list of Gemini-extracted items.
 * Returns at most `maxItems`. Used by both the auto-generate path
 * (promptService.generateAndStoreBatch) and the manual-paste path
 * (POST /api/batches/ingest-raw) so the queue is fed by exactly one
 * cleaning rule set.
 */
export function cleanItems(
  items: { content: string; raw: unknown }[],
  maxItems: number,
): { cleaned: CleanedItem[]; trimmedCount: number; droppedCount: number } {
  const seen = new Set<string>();
  const cleaned: CleanedItem[] = [];
  let trimmedCount = 0;
  let droppedCount = 0;
  for (const item of items) {
    const content = cleanItemContent(item.content);
    if (!content) {
      droppedCount++;
      continue;
    }
    if (seen.has(content.toLowerCase())) {
      droppedCount++;
      continue;
    }
    let final = content;
    if (final.length > MAX_CONTENT_LENGTH) {
      final = final.slice(0, MAX_CONTENT_LENGTH).trimEnd();
      trimmedCount++;
    }
    seen.add(final.toLowerCase());
    cleaned.push({ content: final, raw: item.raw });
    if (cleaned.length >= maxItems) break;
  }
  return { cleaned, trimmedCount, droppedCount };
}

export const promptService = {
  async generateAndStoreBatch(): Promise<{
    inserted: number;
    batchId: string;
    sourceUrl: string | null;
    error?: string;
  }> {
    const settings = settingsService.get();
    const postsPerGeneration = Math.max(
      1,
      Math.min(10, settings.postsPerGeneration || settings.batchSize || 10),
    );

    const ctx = await sourceService.getNextSourceContext();
    const personalProfile = personalProfileService.getPromptContext();
    const personalProfileUsed = personalProfile.length > 0;
    const finalPrompt = buildPrompt(
      settings.llmPrompt,
      postsPerGeneration,
      ctx,
      personalProfile,
    );

    logService.info('Batch request: sending prompt to Gemini reader.', {
      postsPerGeneration,
      sourceUrl: ctx.url,
      sourceTextChars: ctx.text.length,
      finalPromptChars: finalPrompt.length,
      personalProfileUsed,
    });

    const result = await extensionGateway.generateNextBatch({
      prompt: finalPrompt,
      batchSize: postsPerGeneration,
    });

    if (!result.success || !result.rawText) {
      logService.error('Gemini request failed.', result);
      return {
        inserted: 0,
        batchId: '',
        sourceUrl: ctx.url,
        error: result.error ?? 'Unknown Gemini error.',
      };
    }

    logService.info('Batch raw response received from Gemini.', {
      rawLength: result.rawText.length,
      preview: result.rawText.slice(0, 200),
    });

    const extracted = jsonExtractionService.extract(result.rawText);
    if (extracted.error || !extracted.items.length) {
      logService.error('Could not parse Gemini response as JSON.', {
        error: extracted.error,
        preview: extracted.preview,
      });
      return {
        inserted: 0,
        batchId: '',
        sourceUrl: ctx.url,
        error: extracted.error ?? 'No items found in Gemini response.',
      };
    }
    logService.info('JSON parsed; normalized items extracted.', {
      itemCount: extracted.items.length,
    });

    // Per-item validation: trim, dedupe, length cap. Shared with the
    // manual-paste ingest route so both paths produce byte-identical rows.
    const { cleaned, trimmedCount, droppedCount } = cleanItems(
      extracted.items,
      postsPerGeneration,
    );

    if (cleaned.length === 0) {
      const msg = `No valid posts after cleaning (${extracted.items.length} returned).`;
      logService.warn(msg, { droppedCount, trimmedCount });
      return { inserted: 0, batchId: '', sourceUrl: ctx.url, error: msg };
    }

    if (cleaned.length < postsPerGeneration) {
      logService.warn(
        `Generated ${cleaned.length} valid posts out of ${extracted.items.length} returned items (requested ${postsPerGeneration}).`,
        { droppedCount, trimmedCount },
      );
    } else {
      logService.info(
        `Generated ${cleaned.length} valid posts out of ${extracted.items.length} returned items.`,
        { droppedCount, trimmedCount },
      );
    }

    const { batchId, items } = queueService.insertBatch(cleaned, {
      sourceId: ctx.sourceId,
      sourceUrl: ctx.url,
      categoryId: ctx.categoryId,
      categoryName: ctx.categoryName ?? (ctx.sourceId ? null : 'Uncategorized'),
    });
    logService.info('Queue items inserted.', {
      batchId,
      itemCount: items.length,
      sourceId: ctx.sourceId,
      sourceUrl: ctx.url,
      categoryId: ctx.categoryId,
      categoryName: ctx.categoryName,
    });
    // The batch scheduler is the single owner of the post-schedule hook
    // after a successful batch (it calls postScheduler.onScheduleAffectingChange).
    // No direct hook here to avoid double-firing.
    return { inserted: items.length, batchId, sourceUrl: ctx.url };
  },
};
