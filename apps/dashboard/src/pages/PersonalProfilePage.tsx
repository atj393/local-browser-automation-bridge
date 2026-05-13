import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { PersonalProfile, PersonalProfileResponse } from '../api/types.js';

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
    safetyRules: [
      'Do not generate hate, harassment, or insults against protected groups.',
      'Avoid offensive religious comparisons.',
      'Keep opinions strong but respectful.',
    ],
  };
}

function sampleProfile(): PersonalProfile {
  return {
    whoAmI:
      'Indian software developer interested in AI, automation, startups, and practical technology.',
    shortBio:
      'Builds developer-productivity tools. Lives between India and Germany contexts.',
    likes: [
      'Pro India',
      'Pro Germany',
      'Pro Tamil Nadu',
      'Pro Kerala',
      'Pro AI-based development',
      'Pro startup mindset',
      'Pro Christian values',
    ],
    dislikes: [
      'Generic motivational fluff',
      'Clickbait headlines',
      'Aggressive political attacks',
    ],
    avoidTopics: [
      'Islam-related topics unless neutral factual context is unavoidable',
      'Religious comparison',
      'Hate or harassment',
    ],
    tone: {
      primary: [
        'thoughtful',
        'personal',
        'mildly sarcastic',
        'sharp but respectful',
        'human',
        'natural',
      ],
      avoid: ['offensive', 'robotic', 'generic', 'clickbait', 'hateful'],
    },
    geographicPreferences: ['India', 'Tamil Nadu', 'Kerala', 'Germany'],
    topicInterests: [
      'AI',
      'LLMs',
      'software development',
      'automation',
      'startups',
      'politics',
      'productivity',
      'developer tools',
      'Indian tech ecosystem',
      'Tamil Nadu public life',
      'Germany/India life comparison',
    ],
    values: [
      'Pro TVK Tamil Nadu',
      'Pro Vijay',
      'Practical technology learning',
      'Developer productivity',
    ],
    writingRules: [
      'Write like a real person',
      'Avoid generic motivational posts',
      'Prefer clear opinions',
      'Add useful context',
      'Keep it respectful',
    ],
    hashtagPreferences: {
      enabled: true,
      min: 1,
      max: 3,
      preferred: ['#AI', '#TamilNadu', '#Germany'],
      avoid: [],
    },
    languagePreference: 'English',
    customInstructions: '',
    safetyRules: [
      'Do not generate hate, harassment, or insults against protected groups.',
      'Avoid offensive religious comparisons.',
      'Keep opinions strong but respectful.',
    ],
  };
}

function TagListEditor({
  label,
  hint,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (items.some((i) => i.toLowerCase() === v.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...items, v]);
    setDraft('');
  };
  return (
    <div className="field">
      <label>{label}</label>
      {hint && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          {hint}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 6,
          minHeight: 28,
        }}
      >
        {items.map((it, idx) => (
          <span
            key={`${it}-${idx}`}
            className="badge muted"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {it}
            <button
              type="button"
              className="btn secondary"
              style={{ fontSize: 10, padding: '2px 6px' }}
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              aria-label={`Remove ${it}`}
            >
              ×
            </button>
          </span>
        ))}
        {items.length === 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            No items yet.
          </span>
        )}
      </div>
      <div className="row">
        <input
          type="text"
          value={draft}
          placeholder={placeholder ?? 'Add an item and press Enter'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button type="button" className="btn secondary" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

export function PersonalProfilePage() {
  const [state, setState] = useState<PersonalProfileResponse | null>(null);
  const [profile, setProfile] = useState<PersonalProfile>(emptyProfile());
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api.getPersonalProfile();
      setState(r);
      setProfile(r.profile);
      setEnabled(r.isEnabled);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.updatePersonalProfile({ isEnabled: enabled, profile });
      setState(r);
      setProfile(r.profile);
      setEnabled(r.isEnabled);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirm('Reset personal profile to empty defaults? This disables personalization.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.resetPersonalProfile();
      setState(r);
      setProfile(r.profile);
      setEnabled(r.isEnabled);
      setSavedAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function fillSample() {
    if (
      !confirm(
        'Fill sample profile? This overwrites the current draft in the form (not saved until you click Save).',
      )
    ) {
      return;
    }
    setProfile(sampleProfile());
  }

  const h = profile.hashtagPreferences;

  return (
    <div>
      <h1 className="h1">Personal Profile</h1>
      <div className="muted" style={{ marginBottom: 16 }}>
        Define your identity, tone, preferences, and writing rules. When
        enabled, this is injected into the Gemini prompt so generated posts
        sound like you. Stored locally in SQLite; never sent anywhere except
        the Gemini page through the local browser automation flow.
      </div>

      <div className="panel">
        <div className="checkbox-row" style={{ marginBottom: 10 }}>
          <input
            id="profile-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <label htmlFor="profile-enabled" style={{ marginBottom: 0 }}>
            <strong>Use personal profile when generating posts</strong>
          </label>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          When off, the prompt builder ignores this profile entirely. When on,
          a profile summary is appended to the Gemini prompt along with a
          fixed safety boundary block.
        </div>
      </div>

      <div className="panel">
        <h2 className="h2" style={{ marginTop: 0 }}>Identity</h2>
        <div className="field">
          <label>Who am I?</label>
          <textarea
            rows={4}
            value={profile.whoAmI}
            placeholder="Describe yourself, your background, profession, and public voice."
            onChange={(e) => setProfile({ ...profile, whoAmI: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Short bio</label>
          <textarea
            rows={2}
            value={profile.shortBio}
            placeholder="Short summary used as generation context."
            onChange={(e) => setProfile({ ...profile, shortBio: e.target.value })}
          />
        </div>
      </div>

      <div className="panel">
        <h2 className="h2" style={{ marginTop: 0 }}>Preferences</h2>
        <TagListEditor
          label="Likes / positive preferences"
          items={profile.likes}
          onChange={(v) => setProfile({ ...profile, likes: v })}
          placeholder="e.g. Pro India"
        />
        <TagListEditor
          label="Values / identity signals"
          items={profile.values}
          onChange={(v) => setProfile({ ...profile, values: v })}
          placeholder="e.g. Pro startup mindset"
        />
        <TagListEditor
          label="Dislikes"
          items={profile.dislikes}
          onChange={(v) => setProfile({ ...profile, dislikes: v })}
          placeholder="e.g. Clickbait headlines"
        />
        <TagListEditor
          label="Avoided topics"
          hint="Content-avoidance guidance, NOT instructions to attack anyone. Posts will skip these unless the source is specifically about them and a neutral mention is necessary."
          items={profile.avoidTopics}
          onChange={(v) => setProfile({ ...profile, avoidTopics: v })}
          placeholder="e.g. Religious comparison"
        />
      </div>

      <div className="panel">
        <h2 className="h2" style={{ marginTop: 0 }}>Tone</h2>
        <TagListEditor
          label="Preferred tone"
          items={profile.tone.primary}
          onChange={(v) =>
            setProfile({ ...profile, tone: { ...profile.tone, primary: v } })
          }
          placeholder="e.g. thoughtful, mildly sarcastic"
        />
        <TagListEditor
          label="Tone to avoid"
          items={profile.tone.avoid}
          onChange={(v) =>
            setProfile({ ...profile, tone: { ...profile.tone, avoid: v } })
          }
          placeholder="e.g. robotic, clickbait"
        />
      </div>

      <div className="panel">
        <h2 className="h2" style={{ marginTop: 0 }}>Topics &amp; geography</h2>
        <TagListEditor
          label="Geographic preferences"
          items={profile.geographicPreferences}
          onChange={(v) => setProfile({ ...profile, geographicPreferences: v })}
          placeholder="e.g. India, Tamil Nadu, Germany"
        />
        <TagListEditor
          label="Topic interests"
          items={profile.topicInterests}
          onChange={(v) => setProfile({ ...profile, topicInterests: v })}
          placeholder="e.g. AI, LLMs, startups"
        />
        <TagListEditor
          label="Writing rules"
          items={profile.writingRules}
          onChange={(v) => setProfile({ ...profile, writingRules: v })}
          placeholder="e.g. Write like a real person"
        />
      </div>

      <div className="panel">
        <h2 className="h2" style={{ marginTop: 0 }}>Hashtag preferences</h2>
        <div className="checkbox-row" style={{ marginBottom: 8 }}>
          <input
            id="hashtags-enabled"
            type="checkbox"
            checked={h.enabled}
            onChange={(e) =>
              setProfile({
                ...profile,
                hashtagPreferences: { ...h, enabled: e.target.checked },
              })
            }
          />
          <label htmlFor="hashtags-enabled" style={{ marginBottom: 0 }}>
            Use hashtags
          </label>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: '0 0 120px' }}>
            <label>Min</label>
            <input
              type="number"
              min={0}
              max={5}
              value={h.min}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  hashtagPreferences: {
                    ...h,
                    min: Math.max(0, Math.min(5, Number(e.target.value) || 0)),
                  },
                })
              }
            />
          </div>
          <div style={{ flex: '0 0 120px' }}>
            <label>Max</label>
            <input
              type="number"
              min={0}
              max={5}
              value={h.max}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  hashtagPreferences: {
                    ...h,
                    max: Math.max(0, Math.min(5, Number(e.target.value) || 0)),
                  },
                })
              }
            />
          </div>
        </div>
        <TagListEditor
          label="Preferred hashtags"
          items={h.preferred}
          onChange={(v) =>
            setProfile({
              ...profile,
              hashtagPreferences: { ...h, preferred: v },
            })
          }
          placeholder="e.g. #AI"
        />
        <TagListEditor
          label="Hashtags to avoid"
          items={h.avoid}
          onChange={(v) =>
            setProfile({
              ...profile,
              hashtagPreferences: { ...h, avoid: v },
            })
          }
          placeholder="e.g. #spam"
        />
      </div>

      <div className="panel">
        <h2 className="h2" style={{ marginTop: 0 }}>Custom</h2>
        <div className="field">
          <label>Language preference</label>
          <input
            type="text"
            value={profile.languagePreference}
            onChange={(e) =>
              setProfile({ ...profile, languagePreference: e.target.value })
            }
            placeholder="English"
          />
        </div>
        <div className="field">
          <label>Custom instructions</label>
          <textarea
            rows={5}
            value={profile.customInstructions}
            placeholder="Anything else the model should know. Free-form."
            onChange={(e) =>
              setProfile({ ...profile, customInstructions: e.target.value })
            }
          />
        </div>
      </div>

      <div className="panel">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
          <button className="btn secondary" disabled={busy} onClick={reset}>
            Reset profile
          </button>
          <button className="btn secondary" disabled={busy} onClick={fillSample}>
            Fill sample profile
          </button>
          {savedAt && (
            <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
              Saved at {savedAt}
            </span>
          )}
          {state?.updatedAt && (
            <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>
              Last saved: {new Date(state.updatedAt).toLocaleString()}
            </span>
          )}
        </div>
        {error && (
          <div className="mono" style={{ color: 'var(--danger)', marginTop: 8 }}>
            {error}
          </div>
        )}
        <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
          The backend always appends a fixed safety boundary block when this
          profile is used: no hate, no harassment, no broad negative claims
          about protected groups. Strong opinions are okay; abuse is not.
        </div>
      </div>
    </div>
  );
}
