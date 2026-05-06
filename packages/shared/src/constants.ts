export const BACKEND_PORT = 4000;
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
export const WS_PATH = '/ws';
export const WS_URL = `ws://localhost:${BACKEND_PORT}${WS_PATH}`;

export const TEST_WRITER_PATH = '/test/writer';
export const TEST_LLM_PATH = '/test/llm';

export const DEFAULT_LLM_PROMPT = `Generate exactly 10 short posts for a demo queue.

Return only valid JSON.

Use this structure:

{
  "items": [
    {
      "content": "Short post content here"
    }
  ]
}

Rules:
- Return exactly 10 items.
- Each content must be less than 240 characters.
- Use clear, neutral, professional language.
- No political persuasion.
- No hate, harassment, adult content, medical claims, financial claims, or illegal content.
- No spammy wording.
- No hashtags unless naturally relevant.
- No emojis.
- No markdown.
- No explanation outside JSON.
`;

export const POST_STATUSES = [
  'pending',
  'scheduled',
  'posting',
  'posted',
  'failed',
  'skipped',
] as const;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export const TIMEOUTS = {
  generateBatchMs: 150_000,
  postToWriterMs: 30_000,
} as const;

export const MAX_CONTENT_LENGTH = 280;
