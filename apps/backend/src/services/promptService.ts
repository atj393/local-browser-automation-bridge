import { extensionGateway } from '../websocket/extensionGateway.js';
import { jsonExtractionService } from './jsonExtractionService.js';
import { queueService } from './queueService.js';
import { settingsService } from './settingsService.js';
import { logService } from './logService.js';
import { MAX_CONTENT_LENGTH } from '@lbab/shared';

export const promptService = {
  async generateAndStoreBatch(): Promise<{
    inserted: number;
    batchId: string;
    error?: string;
  }> {
    const settings = settingsService.get();
    logService.info('Batch request: sending prompt to Gemini reader.', {
      batchSize: settings.batchSize,
      promptPreview: settings.llmPrompt.slice(0, 120),
    });

    const result = await extensionGateway.generateNextBatch({
      prompt: settings.llmPrompt,
      batchSize: settings.batchSize,
    });

    if (!result.success || !result.rawText) {
      logService.error('Gemini request failed.', result);
      return { inserted: 0, batchId: '', error: result.error ?? 'Unknown Gemini error.' };
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
        error: extracted.error ?? 'No items found in Gemini response.',
      };
    }
    logService.info('JSON parsed; normalized items extracted.', {
      itemCount: extracted.items.length,
    });

    const truncated = extracted.items.map((item) => {
      const t = queueService.truncateContent(item.content);
      if (t.wasTrimmed) {
        logService.warn(`Trimmed item to ${MAX_CONTENT_LENGTH} chars`, {
          original: item.content.length,
        });
      }
      return { content: t.trimmed, raw: item.raw };
    });

    const limited = truncated.slice(0, settings.batchSize);
    const { batchId, items } = queueService.insertBatch(limited);
    logService.info('Queue items inserted.', { batchId, count: items.length });
    return { inserted: items.length, batchId };
  },
};
