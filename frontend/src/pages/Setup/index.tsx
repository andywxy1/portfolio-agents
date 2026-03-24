import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfig, useUpdateConfig, useValidateConfig } from '../../api/hooks';
import type { AppConfig, ValidationResult } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = ['Welcome', 'Alpaca', 'LLM', 'Advanced', 'Done'] as const;

const MODEL_PRESETS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'gpt-5-mini',
  'gpt-5',
  'deepseek-r1',
  'llama-4-maverick',
] as const;

const DEFAULT_CONFIG: Partial<AppConfig> = {
  alpaca_base_url: 'https://paper-api.alpaca.markets',
  llm_base_url: 'http://localhost:8317/v1',
  llm_quick_model: 'claude-sonnet-4-6',
  llm_deep_model: 'claude-opus-4-6',
  weight_heavy_threshold: 10,
  weight_medium_threshold: 3,
};

// ---------------------------------------------------------------------------
// Setup Page
// ---------------------------------------------------------------------------

export default function Setup() {
  const navigate = useNavigate();
  const { data: existingConfig } = useConfig();
  const updateConfig = useUpdateConfig();
  const validateConfigMutation = useValidateConfig();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Partial<AppConfig>>(() => ({
    ...DEFAULT_CONFIG,
    ...existingConfig,
  }));
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  // Track which fields the user has actually changed (Fix 5)
  const changedFieldsRef = useRef<Set<string>>(new Set());

  // Reload form state when existingConfig loads (Fix 4)
  useEffect(() => {
    if (existingConfig) {
      setForm((prev) => ({ ...DEFAULT_CONFIG, ...existingConfig, ...Object.fromEntries(
        Array.from(changedFieldsRef.current).map(k => [k, prev[k as keyof AppConfig]])
      ) }));
    }
  }, [existingConfig]);

  const updateField = useCallback(
    <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
      changedFieldsRef.current.add(key);
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const togglePassword = useCallback((field: string) => {
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  }, []);

  const handleTestAlpaca = useCallback(async () => {
    setValidation(null);
    const result = await validateConfigMutation.mutateAsync({
      alpaca_api_key: form.alpaca_api_key,
      alpaca_secret_key: form.alpaca_secret_key,
      alpaca_base_url: form.alpaca_base_url,
    });
    setValidation(result);
  }, [form.alpaca_api_key, form.alpaca_secret_key, form.alpaca_base_url, validateConfigMutation]);

  const handleTestLLM = useCallback(async () => {
    setValidation(null);
    const result = await validateConfigMutation.mutateAsync({
      llm_base_url: form.llm_base_url,
      llm_api_key: form.llm_api_key,
      llm_quick_model: form.llm_quick_model,
    });
    setValidation(result);
  }, [form.llm_base_url, form.llm_api_key, form.llm_quick_model, validateConfigMutation]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    try {
      // Only send fields the user actually changed - avoid sending masked "****" values (Fix 5)
      const payload: Partial<AppConfig> = {};
      const changed = changedFieldsRef.current;
      if (changed.size === 0) {
        // If nothing changed but we're on initial setup, send all non-masked fields
        for (const [k, v] of Object.entries(form)) {
          if (typeof v === 'string' && v.includes('****')) continue;
          (payload as Record<string, unknown>)[k] = v;
        }
      } else {
        for (const key of changed) {
          const val = form[key as keyof AppConfig];
          if (typeof val === 'string' && val.includes('****')) continue;
          (payload as Record<string, unknown>)[key] = val;
        }
      }
      await updateConfig.mutateAsync(payload);
      setStep(STEPS.length - 1);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to save configuration');
    }
  }, [form, updateConfig]);

  const handleLaunch = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const next = () => {
    if (step === STEPS.length - 2) {
      handleSave();
    } else {
      setValidation(null);
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  };

  const back = () => {
    setValidation(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-12">
      <div className="w-full max-w-xl">
        {/* Stepper */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  i < step
                    ? 'bg-emerald-500 text-white'
                    : i === step
                    ? 'bg-emerald-500/20 text-emerald-400 ring-2 ring-emerald-500'
                    : 'bg-slate-700 text-slate-500'
                }`}
              >
                {i < step ? (
                  <CheckIcon className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`h-0.5 w-6 transition-colors ${
                    i < step ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/80 shadow-2xl backdrop-blur">
          <div className="p-8">
            {step === 0 && <WelcomeStep />}
            {step === 1 && (
              <AlpacaStep
                form={form}
                updateField={updateField}
                showPasswords={showPasswords}
                togglePassword={togglePassword}
                onTest={handleTestAlpaca}
                testing={validateConfigMutation.isPending}
                validation={validation}
              />
            )}
            {step === 2 && (
              <LLMStep
                form={form}
                updateField={updateField}
                showPasswords={showPasswords}
                togglePassword={togglePassword}
                onTest={handleTestLLM}
                testing={validateConfigMutation.isPending}
                validation={validation}
              />
            )}
            {step === 3 && (
              <AdvancedStep
                form={form}
                updateField={updateField}
                showPasswords={showPasswords}
                togglePassword={togglePassword}
                showAdvanced={showAdvanced}
                setShowAdvanced={setShowAdvanced}
              />
            )}
            {step === 4 && <DoneStep form={form} />}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-slate-700/50 px-8 py-4">
            {step > 0 && step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={back}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 transition-colors hover:text-white"
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {saveError && (
              <p className="text-sm text-red-400">{saveError}</p>
            )}

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={next}
                disabled={updateConfig.isPending}
                className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500 disabled:opacity-50"
              >
                {step === 0
                  ? 'Get Started'
                  : step === STEPS.length - 2
                  ? updateConfig.isPending
                    ? 'Saving...'
                    : 'Save & Finish'
                  : 'Continue'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLaunch}
                className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-500"
              >
                Launch Dashboard
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step Components
// ---------------------------------------------------------------------------

function WelcomeStep() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400">
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605"
          />
        </svg>
      </div>
      <h2 className="mb-2 text-2xl font-bold text-white">Portfolio Agents</h2>
      <p className="mb-1 text-lg text-slate-300">AI-Powered Portfolio Analysis</p>
      <p className="text-sm text-slate-500">
        Let's get you set up. We'll connect your brokerage account and configure your AI analysis engine in just a few steps.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface StepProps {
  form: Partial<AppConfig>;
  updateField: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
  showPasswords: Record<string, boolean>;
  togglePassword: (field: string) => void;
}

interface ConnectionStepProps extends StepProps {
  onTest: () => void;
  testing: boolean;
  validation: ValidationResult | null;
}

function AlpacaStep({
  form,
  updateField,
  showPasswords,
  togglePassword,
  onTest,
  testing,
  validation,
}: ConnectionStepProps) {
  return (
    <div>
      <h2 className="mb-1 text-xl font-bold text-white">Alpaca API Keys</h2>
      <p className="mb-6 text-sm text-slate-400">
        Connect your Alpaca brokerage account.{' '}
        <a
          href="https://alpaca.markets"
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-400 underline hover:text-emerald-300"
        >
          Get keys at alpaca.markets
        </a>
      </p>

      <div className="space-y-4">
        <PasswordField
          label="API Key"
          value={form.alpaca_api_key ?? ''}
          onChange={(v) => updateField('alpaca_api_key', v)}
          show={showPasswords['alpaca_api_key']}
          onToggle={() => togglePassword('alpaca_api_key')}
          placeholder="PK..."
        />
        <PasswordField
          label="Secret Key"
          value={form.alpaca_secret_key ?? ''}
          onChange={(v) => updateField('alpaca_secret_key', v)}
          show={showPasswords['alpaca_secret_key']}
          onToggle={() => togglePassword('alpaca_secret_key')}
          placeholder="Your Alpaca secret key"
        />

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Base URL
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                updateField('alpaca_base_url', 'https://paper-api.alpaca.markets')
              }
              className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                form.alpaca_base_url === 'https://paper-api.alpaca.markets'
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                  : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500'
              }`}
            >
              Paper Trading
            </button>
            <button
              type="button"
              onClick={() =>
                updateField('alpaca_base_url', 'https://api.alpaca.markets')
              }
              className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                form.alpaca_base_url === 'https://api.alpaca.markets'
                  ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                  : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500'
              }`}
            >
              Live Trading
            </button>
          </div>
        </div>

        <TestConnectionButton
          onTest={onTest}
          testing={testing}
          result={validation?.alpaca}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LLMStep({
  form,
  updateField,
  showPasswords,
  togglePassword,
  onTest,
  testing,
  validation,
}: ConnectionStepProps) {
  return (
    <div>
      <h2 className="mb-1 text-xl font-bold text-white">LLM Configuration</h2>
      <p className="mb-6 text-sm text-slate-400">
        Configure the AI models used for portfolio analysis.
      </p>

      <div className="space-y-4">
        <InputField
          label="Base URL"
          value={form.llm_base_url ?? ''}
          onChange={(v) => updateField('llm_base_url', v)}
          placeholder="http://localhost:8317/v1"
        />

        <PasswordField
          label="API Key"
          value={form.llm_api_key ?? ''}
          onChange={(v) => updateField('llm_api_key', v)}
          show={showPasswords['llm_api_key']}
          onToggle={() => togglePassword('llm_api_key')}
          placeholder="sk-..."
        />

        <SelectField
          label="Quick Model"
          value={form.llm_quick_model ?? ''}
          onChange={(v) => updateField('llm_quick_model', v)}
          options={MODEL_PRESETS}
          helpText="Used for fast tasks like summarization"
        />

        <SelectField
          label="Deep Model"
          value={form.llm_deep_model ?? ''}
          onChange={(v) => updateField('llm_deep_model', v)}
          options={MODEL_PRESETS}
          helpText="Used for in-depth analysis and debates"
        />

        <TestConnectionButton
          onTest={onTest}
          testing={testing}
          result={validation?.llm}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AdvancedStep({
  form,
  updateField,
  showAdvanced,
  setShowAdvanced,
}: StepProps & { showAdvanced: boolean; setShowAdvanced: (v: boolean) => void }) {
  return (
    <div>
      <h2 className="mb-1 text-xl font-bold text-white">Analysis Settings</h2>
      <p className="mb-6 text-sm text-slate-400">
        Optionally tune how positions are categorized by weight.
      </p>

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="mb-4 flex items-center gap-2 text-sm font-medium text-emerald-400 hover:text-emerald-300"
      >
        <svg
          className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
      </button>

      {showAdvanced && (
        <div className="space-y-6 rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
          <SliderField
            label="Heavy Position Threshold"
            value={form.weight_heavy_threshold ?? 10}
            onChange={(v) => updateField('weight_heavy_threshold', v)}
            min={5}
            max={30}
            unit="%"
            helpText="Positions above this weight get deeper analysis"
          />
          <SliderField
            label="Medium Position Threshold"
            value={form.weight_medium_threshold ?? 3}
            onChange={(v) => updateField('weight_medium_threshold', v)}
            min={1}
            max={15}
            unit="%"
            helpText="Positions between medium and heavy get standard analysis"
          />
        </div>
      )}

      {!showAdvanced && (
        <p className="text-sm text-slate-500">
          Defaults: Heavy {'>'}= {form.weight_heavy_threshold ?? 10}%, Medium {'>'}={' '}
          {form.weight_medium_threshold ?? 3}%
        </p>
      )}

      <InputField
        label="App API Key (optional)"
        value={form.api_key ?? ''}
        onChange={(v) => updateField('api_key', v)}
        placeholder="Leave blank to disable API key auth"
        className="mt-6"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function DoneStep({ form }: { form: Partial<AppConfig> }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
        <CheckIcon className="h-8 w-8" />
      </div>
      <h2 className="mb-2 text-2xl font-bold text-white">You're all set!</h2>
      <p className="mb-6 text-sm text-slate-400">
        Your configuration has been saved. Here's a summary:
      </p>

      <div className="mx-auto max-w-sm space-y-2 text-left">
        <SummaryRow label="Alpaca" value={form.alpaca_base_url?.includes('paper') ? 'Paper Trading' : 'Live Trading'} />
        <SummaryRow label="LLM Endpoint" value={form.llm_base_url ?? 'Not set'} />
        <SummaryRow label="Quick Model" value={form.llm_quick_model ?? 'Not set'} />
        <SummaryRow label="Deep Model" value={form.llm_deep_model ?? 'Not set'} />
        <SummaryRow
          label="Thresholds"
          value={`Heavy >= ${form.weight_heavy_threshold ?? 10}%, Medium >= ${form.weight_medium_threshold ?? 3}%`}
        />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-700/40 px-4 py-2">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form primitives
// ---------------------------------------------------------------------------

function InputField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium text-slate-300">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
      />
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-300">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2.5 pr-10 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300"
          aria-label={show ? 'Hide value' : 'Show value'}
        >
          {show ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  helpText,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  helpText?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-300">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {helpText && <p className="mt-1 text-xs text-slate-500">{helpText}</p>}
    </div>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  helpText,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  unit?: string;
  helpText?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium text-slate-300">{label}</label>
        <span className="text-sm font-semibold text-emerald-400">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
      {helpText && <p className="mt-1 text-xs text-slate-500">{helpText}</p>}
    </div>
  );
}

function TestConnectionButton({
  onTest,
  testing,
  result,
}: {
  onTest: () => void;
  testing: boolean;
  result?: { ok: boolean; error?: string };
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onTest}
        disabled={testing}
        className="rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-emerald-500 hover:text-white disabled:opacity-50"
      >
        {testing ? 'Testing...' : 'Test Connection'}
      </button>
      {result && (
        <span
          className={`ml-3 inline-flex items-center gap-1 text-sm font-medium ${
            result.ok ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {result.ok ? (
            <>
              <CheckIcon className="h-4 w-4" /> Connected
            </>
          ) : (
            <>
              <XIcon className="h-4 w-4" /> {result.error ?? 'Connection failed'}
            </>
          )}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Icons
// ---------------------------------------------------------------------------

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  );
}
