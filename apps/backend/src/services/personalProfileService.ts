import type {
  PersonalProfile,
  PersonalProfileHashtagPreferences,
  PersonalProfileResponse,
  PersonalProfileTone,
  UpdatePersonalProfileRequest,
} from '@lbab/shared';
import { getDb } from '../db/database.js';
import { nowIso } from '../utils/date.js';
import { logService } from './logService.js';

const MAX_WHO_AM_I = 2000;
const MAX_SHORT_BIO = 1000;
const MAX_CUSTOM = 4000;
const MAX_ITEM_LEN = 300;
const MAX_ITEMS = 100;

const DEFAULT_SAFETY_RULES = [
  'Do not generate hate, harassment, or insults against protected groups.',
  'Avoid offensive religious comparisons.',
  'Keep opinions strong but respectful.',
];

function emptyProfile(): PersonalProfile {
  return {
    whoAmI: '',
    shortBio: '',
    likes: [],
    dislikes: [],
    avoidTopics: [],
    tone: { primary: [], avoid: [] },
    geographicPreferences: [],
    topicInterests: [],
    values: [],
    writingRules: [],
    hashtagPreferences: {
      enabled: true,
      min: 1,
      max: 3,
      preferred: [],
      avoid: [],
    },
    languagePreference: 'English',
    customInstructions: '',
    safetyRules: [...DEFAULT_SAFETY_RULES],
  };
}

function clampStr(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim().slice(0, MAX_ITEM_LEN);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function normalizeTone(value: unknown): PersonalProfileTone {
  if (!value || typeof value !== 'object') return { primary: [], avoid: [] };
  const v = value as Record<string, unknown>;
  return {
    primary: normalizeArray(v.primary),
    avoid: normalizeArray(v.avoid),
  };
}

function normalizeHashtags(value: unknown): PersonalProfileHashtagPreferences {
  const base: PersonalProfileHashtagPreferences = {
    enabled: true,
    min: 1,
    max: 3,
    preferred: [],
    avoid: [],
  };
  if (!value || typeof value !== 'object') return base;
  const v = value as Record<string, unknown>;
  const enabled = typeof v.enabled === 'boolean' ? v.enabled : base.enabled;
  let min = typeof v.min === 'number' && Number.isFinite(v.min) ? Math.floor(v.min) : base.min;
  let max = typeof v.max === 'number' && Number.isFinite(v.max) ? Math.floor(v.max) : base.max;
  min = Math.max(0, Math.min(5, min));
  max = Math.max(0, Math.min(5, max));
  if (max < min) max = min;
  return {
    enabled,
    min,
    max,
    preferred: normalizeArray(v.preferred),
    avoid: normalizeArray(v.avoid),
  };
}

function normalizeProfile(partial: Partial<PersonalProfile> | undefined): PersonalProfile {
  const base = emptyProfile();
  if (!partial || typeof partial !== 'object') return base;
  return {
    whoAmI: clampStr(partial.whoAmI, MAX_WHO_AM_I),
    shortBio: clampStr(partial.shortBio, MAX_SHORT_BIO),
    likes: normalizeArray(partial.likes),
    dislikes: normalizeArray(partial.dislikes),
    avoidTopics: normalizeArray(partial.avoidTopics),
    tone: normalizeTone(partial.tone),
    geographicPreferences: normalizeArray(partial.geographicPreferences),
    topicInterests: normalizeArray(partial.topicInterests),
    values: normalizeArray(partial.values),
    writingRules: normalizeArray(partial.writingRules),
    hashtagPreferences: normalizeHashtags(partial.hashtagPreferences),
    languagePreference: clampStr(partial.languagePreference, 60) || 'English',
    customInstructions: clampStr(partial.customInstructions, MAX_CUSTOM),
    safetyRules:
      partial.safetyRules && Array.isArray(partial.safetyRules)
        ? normalizeArray(partial.safetyRules)
        : [...DEFAULT_SAFETY_RULES],
  };
}

interface ProfileRow {
  id: number;
  profile_json: string;
  is_enabled: number;
  updated_at: string;
}

function loadRow(): ProfileRow {
  const db = getDb();
  let row = db.prepare('SELECT * FROM personal_profile WHERE id = 1').get() as
    | unknown as
    | ProfileRow
    | undefined;
  if (!row) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO personal_profile (id, profile_json, is_enabled, created_at, updated_at)
       VALUES (1, ?, 0, ?, ?)`,
    ).run(JSON.stringify(emptyProfile()), now, now);
    row = db.prepare('SELECT * FROM personal_profile WHERE id = 1').get() as unknown as ProfileRow;
  }
  return row;
}

function parseProfile(json: string): PersonalProfile {
  try {
    const parsed = JSON.parse(json) as Partial<PersonalProfile>;
    return normalizeProfile(parsed);
  } catch {
    logService.warn('personal_profile JSON parse failed; returning empty profile.');
    return emptyProfile();
  }
}

function bulletList(items: string[]): string {
  return items.map((s) => `- ${s}`).join('\n');
}

export const personalProfileService = {
  get(): PersonalProfileResponse {
    const row = loadRow();
    return {
      isEnabled: !!row.is_enabled,
      profile: parseProfile(row.profile_json),
      updatedAt: row.updated_at,
    };
  },

  update(body: UpdatePersonalProfileRequest): PersonalProfileResponse {
    const row = loadRow();
    const current = parseProfile(row.profile_json);
    const merged = body.profile ? normalizeProfile({ ...current, ...body.profile }) : current;
    const enabled =
      typeof body.isEnabled === 'boolean' ? body.isEnabled : !!row.is_enabled;
    const now = nowIso();
    const db = getDb();
    db.prepare(
      `UPDATE personal_profile
         SET profile_json = ?, is_enabled = ?, updated_at = ?
       WHERE id = 1`,
    ).run(JSON.stringify(merged), enabled ? 1 : 0, now);
    return { isEnabled: enabled, profile: merged, updatedAt: now };
  },

  reset(): PersonalProfileResponse {
    const now = nowIso();
    const db = getDb();
    db.prepare(
      `UPDATE personal_profile
         SET profile_json = ?, is_enabled = 0, updated_at = ?
       WHERE id = 1`,
    ).run(JSON.stringify(emptyProfile()), now);
    return { isEnabled: false, profile: emptyProfile(), updatedAt: now };
  },

  /**
   * Returns a Gemini-ready text block summarizing the profile.
   * Returns an empty string when personalization is disabled or the
   * profile is effectively empty — so callers can blindly append.
   */
  getPromptContext(): string {
    const row = loadRow();
    if (!row.is_enabled) return '';
    const p = parseProfile(row.profile_json);

    const sections: string[] = [];

    if (p.whoAmI) {
      sections.push(`Who I am:\n${p.whoAmI}`);
    }
    if (p.shortBio) {
      sections.push(`Short bio:\n${p.shortBio}`);
    }
    if (p.likes.length) {
      sections.push(`Likes / positive preferences:\n${bulletList(p.likes)}`);
    }
    if (p.values.length) {
      sections.push(`Values / identity signals:\n${bulletList(p.values)}`);
    }
    if (p.dislikes.length) {
      sections.push(`Dislikes:\n${bulletList(p.dislikes)}`);
    }
    if (p.avoidTopics.length) {
      sections.push(
        `Avoided topics (content-avoidance guidance, NOT instructions to attack anyone):\n${bulletList(p.avoidTopics)}`,
      );
    }
    if (p.tone.primary.length) {
      sections.push(`Preferred tone:\n${bulletList(p.tone.primary)}`);
    }
    if (p.tone.avoid.length) {
      sections.push(`Tone to avoid:\n${bulletList(p.tone.avoid)}`);
    }
    if (p.geographicPreferences.length) {
      sections.push(`Geographic preferences:\n${bulletList(p.geographicPreferences)}`);
    }
    if (p.topicInterests.length) {
      sections.push(`Topic interests:\n${bulletList(p.topicInterests)}`);
    }
    if (p.writingRules.length) {
      sections.push(`Writing rules:\n${bulletList(p.writingRules)}`);
    }
    if (p.hashtagPreferences) {
      const h = p.hashtagPreferences;
      const lines: string[] = [];
      lines.push(`Hashtags enabled: ${h.enabled ? 'yes' : 'no'}`);
      if (h.enabled) {
        lines.push(`Hashtag count range: ${h.min}–${h.max} per post.`);
        if (h.preferred.length) lines.push(`Preferred hashtags: ${h.preferred.join(', ')}`);
        if (h.avoid.length) lines.push(`Hashtags to avoid: ${h.avoid.join(', ')}`);
      }
      sections.push(`Hashtag preferences:\n${lines.join('\n')}`);
    }
    if (p.languagePreference) {
      sections.push(`Language preference: ${p.languagePreference}`);
    }
    if (p.customInstructions) {
      sections.push(`Custom instructions:\n${p.customInstructions}`);
    }

    // Always append non-negotiable safety boundaries. User-supplied
    // safetyRules are layered on top but cannot override these.
    const safety = [
      'Do not generate hate, harassment, or insults against protected groups.',
      'Do not use dehumanizing language.',
      'Do not make broad negative claims about religious, ethnic, caste, nationality, gender, or other protected groups.',
      'Keep political or religious opinions respectful.',
      'Avoid topics listed under "Avoided topics" unless neutral factual context is necessary.',
      ...p.safetyRules.filter((s) => !DEFAULT_SAFETY_RULES.includes(s)),
    ];
    sections.push(`Safety boundaries:\n${bulletList(safety)}`);

    if (sections.length === 1) {
      // Only the safety block — profile is effectively empty.
      return '';
    }

    return ['Personal profile guidance:', ...sections].join('\n\n');
  },

  /** True when personalization is on AND the profile has at least one signal. */
  isPersonalizationActive(): boolean {
    return this.getPromptContext().length > 0;
  },
};
