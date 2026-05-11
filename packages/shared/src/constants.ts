export const BACKEND_PORT = 4000;
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
export const WS_PATH = '/ws';
export const WS_URL = `ws://localhost:${BACKEND_PORT}${WS_PATH}`;

export const TEST_WRITER_PATH = '/test/writer';
export const TEST_LLM_PATH = '/test/llm';

export const DEFAULT_LLM_PROMPT = `You are creating meaningful X.com posts for a professional audience.

Use the provided source/context if available.
If source/context is empty, create useful posts about software development, productivity, AI tools, automation, or practical technology learning.

Return only valid JSON.

Use this structure:

{
  "items": [
    {
      "content": "Post text here"
    }
  ]
}

Rules:
- Generate exactly {{postsPerGeneration}} posts.
- Each post must be less than 260 characters.
- Each post must be meaningful, specific, and useful.
- Do not create random generic filler.
- Add 1 to 3 relevant hashtags at the end of each post.
- Hashtags must be natural and not excessive.
- Avoid clickbait.
- Avoid fake claims.
- Avoid controversial political content.
- Avoid personal attacks, hate, harassment, adult content, medical claims, financial claims, or illegal content.
- No markdown.
- No explanation outside JSON.
- No numbering outside JSON.
- Use clear human language.
- Make each post different from the others.
- Do not repeat the same hashtag set for every post.

If source/context is provided:
- Summarize or transform the source into useful post ideas.
- Do not copy large text directly.
- Write original posts inspired by the source.
- Include relevant hashtags.

Selected source URL:
{{sourceUrl}}

Source/context:
{{sourceContext}}
`;

export const SOURCE_MODES = ['rotate', 'first', 'none'] as const;
export const BATCH_REFILL_MODES = ['immediate', 'random_delay'] as const;
export const QUEUE_SELECTION_MODES = ['oldest_first', 'rotate_categories'] as const;
export const BATCH_INTERVAL_DEFAULT_MIN_SECONDS = 900;
export const BATCH_INTERVAL_DEFAULT_MAX_SECONDS = 1800;

export const POSTS_PER_GENERATION_MIN = 1;
export const POSTS_PER_GENERATION_MAX = 10;
export const POSTS_PER_GENERATION_DEFAULT = 10;

export const SOURCE_FETCH_TIMEOUT_MS = 10_000;
// Some news homepages exceed 1 MB. 4 MB is a comfortable cap that still
// rejects accidental gigabyte downloads.
export const SOURCE_MAX_BYTES = 4_000_000;
export const SOURCE_CONTEXT_MAX_CHARS = 6_000;

export const POST_STATUSES = [
  'pending',
  'scheduled',
  'posting',
  'posted',
  'failed',
  'skipped',
  'needs_manual_post',
] as const;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export const TIMEOUTS = {
  generateBatchMs: 150_000,
  postToWriterMs: 30_000,
} as const;

export const MAX_CONTENT_LENGTH = 280;
