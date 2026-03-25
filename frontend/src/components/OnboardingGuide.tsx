import { useState, useCallback, useEffect } from 'react';

const ONBOARDING_KEY = 'portfolio_onboarding_completed';

const STEPS = [
  {
    number: 1,
    title: 'Add your holdings',
    description: 'Navigate to Holdings and add the stocks in your portfolio.',
    navHint: 'Holdings',
  },
  {
    number: 2,
    title: 'Run analysis',
    description: 'Go to Analysis Results and start a new analysis to evaluate your portfolio.',
    navHint: 'Analysis Results',
  },
  {
    number: 3,
    title: 'Check recommendations',
    description: 'Review AI-generated recommendations and decide which trades to execute.',
    navHint: 'Recommendations',
  },
];

export function OnboardingGuide() {
  const [dismissed, setDismissed] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    try {
      const completed = localStorage.getItem(ONBOARDING_KEY);
      if (!completed) {
        setDismissed(false);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(ONBOARDING_KEY, 'true');
    } catch {
      // ignore
    }
  }, []);

  const next = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(s => s + 1);
    } else {
      dismiss();
    }
  }, [currentStep, dismiss]);

  const prev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(s => s - 1);
    }
  }, [currentStep]);

  if (dismissed) return null;

  const step = STEPS[currentStep];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Onboarding guide">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={dismiss} />
      {/* Panel */}
      <div className="relative z-10 mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Getting Started</h2>
          <button
            onClick={dismiss}
            className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close onboarding guide"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          {STEPS.map((s, i) => (
            <div
              key={s.number}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= currentStep ? 'bg-emerald-500' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold">
              {step.number}
            </span>
            <h3 className="text-base font-semibold text-gray-900">{step.title}</h3>
          </div>
          <p className="text-sm text-gray-600 ml-11">{step.description}</p>
          <p className="text-xs text-gray-400 ml-11 mt-1.5">
            Look for "{step.navHint}" in the sidebar
          </p>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={dismiss}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                onClick={prev}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={next}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 transition-colors"
            >
              {currentStep < STEPS.length - 1 ? 'Next' : 'Get Started'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
