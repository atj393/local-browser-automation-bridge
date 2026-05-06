import { useEffect, useState } from 'react';
import type { AutomationSettings } from '../api/types.js';
import { api } from '../api/client.js';
import { SettingsForm } from '../components/SettingsForm.js';

export function SettingsPage() {
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const s = await api.getSettings();
      setSettings(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <h1 className="h1">Settings</h1>
      {error && <div className="warning-box">{error}</div>}
      {settings ? (
        <SettingsForm
          initial={settings}
          onSave={async (body) => {
            const updated = await api.updateSettings(body);
            setSettings(updated);
          }}
        />
      ) : (
        <div className="panel">Loading…</div>
      )}
    </>
  );
}
