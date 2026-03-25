import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfig, useUpdateConfig, useValidateConfig, useConfigStatus } from '../../api/hooks';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
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

// Session storage key for progress persistence (Fix #12)
const SESSION_KEY_STEP = 'setup_step';
const SESSION_KEY_FORM = 'setup_form';

// ---------------------------------------------------------------------------
// Setup Page
// ---------------------------------------------------------------------------

export default function Setup() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: configStatus } = useConfigStatus();
  const { data: existingConfig } = useConfig();
  const updateConfig = useUpdateConfig();
  const validateConfigMutation = useValidateConfig();

  // Settings mode: user is already configured and is editing settings
  const settingsMode = configStatus?.configured === true;

  // Fix #12: Restore step from sessionStorage
  const [step, setStep] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(SESSION_KEY_STEP);
      if (saved != null) {
        const n = Number(saved);
        if (n >= 0 && n < STEPS.length) return n;
      }
    }
    return 0;
  });

  // Fix #12: Restore form from sessionStorage, merging with defaults and existing config
  const [form, setForm] = useState<Partial<AppConfig>>(() => {
    let sessionForm: Partial<AppConfig> = {};
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem(SESSION_KEY_FORM);
        if (saved) sessionForm = JSON.parse(saved);
      } catch { /* ignore */ }
    }
    return {
      ...DEFAULT_CONFIG,
      ...existingConfig,
      ...sessionForm,
    };
  });

  // Fix #9 & #10: Separate validation state per step
  const [alpacaValidation, setAlpacaValidation] = useState<ValidationResult | null>(null);
  const [llmValidation, setLlmValidation] = useState<ValidationResult | null>(null);

  // Fix #9: Per-step field error tracking
  const [alpacaFieldErrors, setAlpacaFieldErrors] = useState<Record<string, string>>({});
  const [llmFieldErrors, setLlmFieldErrors] = useState<Record<string, string>>({});

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  // Settings mode: track which sections are expanded
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    alpaca: true,
    llm: true,
    advanced: false,
  });

  // Track which fields the user has actually changed (Fix 5)
  const changedFieldsRef = useRef<Set<string>>(new Set());

  // Fix #14: Track unsaved changes for settings mode
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  // Reload form state when existingConfig loads (Fix 4)
  useEffect(() => {
    if (existingConfig) {
      setForm((prev) => ({ ...DEFAULT_CONFIG, ...existingConfig, ...Object.fromEntries(
        Array.from(changedFieldsRef.current).map(k => [k, prev[k as keyof AppConfig]])
      ) }));
    }
  }, [existingConfig]);

  // Fix #12: Persist step and form to sessionStorage
  useEffect(() => {
    if (!settingsMode) {
      sessionStorage.setItem(SESSION_KEY_STEP, String(step));
    }
  }, [step, settingsMode]);

  useEffect(() => {
    if (!settingsMode) {
      try {
        sessionStorage.setItem(SESSION_KEY_FORM, JSON.stringify(form));
      } catch { /* ignore quota errors */ }
    }
  }, [form, settingsMode]);

  const updateField = useCallback(
    <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
      changedFieldsRef.current.add(key);
      setForm((prev) => ({ ...prev, [key]: value }));
      setHasUnsavedChanges(true);
    },
    []
  );

  const togglePassword = useCallback((field: string) => {
    setShowPasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  }, []);

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const handleTestAlpaca = useCallback(async () => {
    setAlpacaValidation(null);
    const result = await validateConfigMutation.mutateAsync({
      alpaca_api_key: form.alpaca_api_key,
      alpaca_secret_key: form.alpaca_secret_key,
      alpaca_base_url: form.alpaca_base_url,
    });
    setAlpacaValidation(result);
  }, [form.alpaca_api_key, form.alpaca_secret_key, form.alpaca_base_url, validateConfigMutation]);

  const handleTestLLM = useCallback(async () => {
    setLlmValidation(null);
    const result = await validateConfigMutation.mutateAsync({
      llm_base_url: form.llm_base_url,
      llm_api_key: form.llm_api_key,
      llm_quick_model: form.llm_quick_model,
    });
    setLlmValidation(result);
  }, [form.llm_base_url, form.llm_api_key, form.llm_quick_model, validateConfigMutation]);

  const buildPayload = useCallback(() => {
    const payload: Partial<AppConfig> = {};
    const changed = changedFieldsRef.current;
    if (changed.size === 0) {
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
    return payload;
  }, [form]);

  // Save for onboarding wizard mode (navigates to Done step)
  const handleSave = useCallback(async () => {
    setSaveError(null);
    try {
      const payload = buildPayload();
      await updateConfig.mutateAsync(payload);
      // Fix #12: Clear session storage on successful save
      sessionStorage.removeItem(SESSION_KEY_STEP);
      sessionStorage.removeItem(SESSION_KEY_FORM);
      setStep(STEPS.length - 1);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to save configuration');
    }
  }, [buildPayload, updateConfig]);

  // Save for settings mode (stays on page, shows toast)
  const handleSettingsSave = useCallback(async () => {
    setSaveError(null);
    try {
      const payload = buildPayload();
      await updateConfig.mutateAsync(payload);
      toast.success('Settings saved successfully');
      changedFieldsRef.current.clear();
      setHasUnsavedChanges(false);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to save configuration');
      toast.error(err?.message ?? 'Failed to save configuration');
    }
  }, [buildPayload, updateConfig, toast]);

  const handleLaunch = useCallback(() => {
    // Fix #12: Clear session storage on launch
    sessionStorage.removeItem(SESSION_KEY_STEP);
    sessionStorage.removeItem(SESSION_KEY_FORM);
    navigate('/');
  }, [navigate]);

  // Fix #14: Navigate back with unsaved changes check
  const handleBackToDashboard = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowDiscardDialog(true);
    } else {
      navigate('/');
    }
  }, [hasUnsavedChanges, navigate]);

  // Fix #9: Validate fields before advancing
  const validateAlpacaStep = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (!form.alpaca_api_key?.trim()) errors.alpaca_api_key = 'API Key is required';
    if (!form.alpaca_secret_key?.trim()) errors.alpaca_secret_key = 'Secret Key is required';
    setAlpacaFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form.alpaca_api_key, form.alpaca_secret_key]);

  const validateLlmStep = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (!form.llm_base_url?.trim()) errors.llm_base_url = 'Base URL is required';
    if (!form.llm_api_key?.trim()) errors.llm_api_key = 'API Key is required';
    setLlmFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form.llm_base_url, form.llm_api_key]);

  const next = () => {
    // Fix #9: Validate before advancing
    if (step === 1 && !validateAlpacaStep()) return;
    if (step === 2 && !validateLlmStep()) return;

    if (step === STEPS.length - 2) {
      handleSave();
    } else {
      // Fix #10: Don't clear validation when navigating between steps
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  };

  const back = () => {
    // Fix #10: Don't clear validation when navigating between steps
    setStep((s) => Math.max(s - 1, 0));
  };

  // ---------------------------------------------------------------------------
  // Settings Mode: single-page layout with collapsible cards
  // Fix #13: Render within a sidebar layout when in settings mode
  // ---------------------------------------------------------------------------
  if (settingsMode) {
    const settingsContent = (
      <div className="w-full max-w-xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your connections and analysis configuration.</p>
        </div>

        {/* Alpaca Section */}
        <SettingsCollapsibleCard
          title="Alpaca API Keys"
          subtitle="Brokerage connection"
          expanded={expandedSections.alpaca}
          onToggle={() => toggleSection('alpaca')}
        >
          <AlpacaStep
            form={form}
            updateField={updateField}
            showPasswords={showPasswords}
            togglePassword={togglePassword}
            onTest={handleTestAlpaca}
            testing={validateConfigMutation.isPending}
            validation={alpacaValidation}
            fieldErrors={{}}
          />
        </SettingsCollapsibleCard>

        {/* LLM Section */}
        <SettingsCollapsibleCard
          title="LLM Configuration"
          subtitle="AI model settings"
          expanded={expandedSections.llm}
          onToggle={() => toggleSection('llm')}
        >
          <LLMStep
            form={form}
            updateField={updateField}
            showPasswords={showPasswords}
            togglePassword={togglePassword}
            onTest={handleTestLLM}
            testing={validateConfigMutation.isPending}
            validation={llmValidation}
            fieldErrors={{}}
          />
        </SettingsCollapsibleCard>

        {/* Advanced Section */}
        <SettingsCollapsibleCard
          title="Advanced Settings"
          subtitle="Thresholds and API key"
          expanded={expandedSections.advanced}
          onToggle={() => toggleSection('advanced')}
        >
          <AdvancedStep
            form={form}
            updateField={updateField}
            showPasswords={showPasswords}
            togglePassword={togglePassword}
            showAdvanced={true}
            setShowAdvanced={() => {}}
          />
        </SettingsCollapsibleCard>

        {/* Save / Back footer */}
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={handleBackToDashboard}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
          >
            Back to Dashboard
          </button>

          {saveError && (
            <p className="text-sm text-red-600">{saveError}</p>
          )}

          <button
            type="button"
            onClick={handleSettingsSave}
            disabled={updateConfig.isPending}
            className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 disabled:opacity-50"
          >
            {updateConfig.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Fix #14: Unsaved changes dialog */}
        <ConfirmDialog
          open={showDiscardDialog}
          title="Unsaved Changes"
          message="You have unsaved changes. Discard?"
          confirmLabel="Discard"
          cancelLabel="Stay"
          destructive
          onConfirm={() => { setShowDiscardDialog(false); navigate('/'); }}
          onCancel={() => setShowDiscardDialog(false)}
        />
      </div>
    );

    // Fix #13: Wrap in sidebar layout (simplified inline sidebar to avoid broken Sidebar import)
    return (
      <div className="flex h-screen">
        <aside className="hidden lg:flex h-full w-64 flex-col bg-slate-900 text-slate-300 flex-shrink-0">
          <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-700/50">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-lg">
              P
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white leading-tight">Portfolio Agents</h1>
              <p className="text-xs text-slate-500">AI-Powered Analysis</p>
            </div>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {[
              { to: '/', label: 'Dashboard' },
              { to: '/holdings', label: 'Holdings' },
              { to: '/analysis', label: 'Analysis Results' },
              { to: '/recommendations', label: 'Recommendations' },
              { to: '/history', label: 'History' },
            ].map(item => (
              <a
                key={item.to}
                href={item.to}
                onClick={(e) => { e.preventDefault(); navigate(item.to); }}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="border-t border-slate-700/50 px-3 py-3">
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium bg-slate-800 text-white">
              Settings
            </div>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto bg-gray-50">
          {settingsContent}
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Onboarding Mode: multi-step wizard (original behavior)
  // ---------------------------------------------------------------------------
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
                validation={alpacaValidation}
                fieldErrors={alpacaFieldErrors}
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
                validation={llmValidation}
                fieldErrors={llmFieldErrors}
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
// Collapsible Card (settings mode - light theme for sidebar layout)
// ---------------------------------------------------------------------------

function SettingsCollapsibleCard({
  title,
  subtitle,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <svg
          className={`h-5 w-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-gray-100 px-6 pb-6 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}

// (Removed unused dark-themed CollapsibleCard; SettingsCollapsibleCard above is used instead)

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
  fieldErrors: Record<string, string>;
}

function AlpacaStep({
  form,
  updateField,
  showPasswords,
  togglePassword,
  onTest,
  testing,
  validation,
  fieldErrors,
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
          error={fieldErrors.alpaca_api_key}
        />
        <PasswordField
          label="Secret Key"
          value={form.alpaca_secret_key ?? ''}
          onChange={(v) => updateField('alpaca_secret_key', v)}
          show={showPasswords['alpaca_secret_key']}
          onToggle={() => togglePassword('alpaca_secret_key')}
          placeholder="Your Alpaca secret key"
          error={fieldErrors.alpaca_secret_key}
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
  fieldErrors,
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
          error={fieldErrors.llm_base_url}
        />

        <PasswordField
          label="API Key"
          value={form.llm_api_key ?? ''}
          onChange={(v) => updateField('llm_api_key', v)}
          show={showPasswords['llm_api_key']}
          onToggle={() => togglePassword('llm_api_key')}
          placeholder="sk-..."
          error={fieldErrors.llm_api_key}
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
      <p className="mb-2 text-sm text-slate-400">
        Optionally tune how positions are categorized by weight.
      </p>
      {/* Fix #11: Skip guidance */}
      <p className="mb-6 text-xs text-slate-500">
        These settings are optional. You can skip this step and use defaults.
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
          Defaults: Heavy {'>'} = {form.weight_heavy_threshold ?? 10}%, Medium {'>'}={' '}
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
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  error?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium text-slate-300">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border bg-slate-700/50 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 ${
          error ? 'border-red-500' : 'border-slate-600'
        }`}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
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
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
  error?: string;
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
          className={`w-full rounded-lg border bg-slate-700/50 px-3 py-2.5 pr-10 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 ${
            error ? 'border-red-500' : 'border-slate-600'
          }`}
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
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
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
