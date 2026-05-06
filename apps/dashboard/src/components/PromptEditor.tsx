interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function PromptEditor({ value, onChange }: Props) {
  return (
    <div className="field">
      <label htmlFor="llm-prompt">LLM prompt sent to Gemini</label>
      <textarea
        id="llm-prompt"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={16}
      />
    </div>
  );
}
