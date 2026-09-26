"use client";

import { FormEvent, useState } from "react";

export interface OnboardingProject {
  id: string;
  name: string;
  location?: string;
  availableCredits?: number;
}

export interface OnboardingProfile {
  name: string;
  email: string;
}

export interface OnboardingCompletion {
  profile: OnboardingProfile;
  projectId: string;
  creditAmount: number;
  retirementReason: string;
}

export interface OnboardingFlowProps {
  walletAddress?: string | null;
  projects?: OnboardingProject[];
  initialProfile?: Partial<OnboardingProfile>;
  initialProjectId?: string;
  onConnectWallet?: () => void;
  onBrowseProjects?: () => void;
  onBuyCredit?: (projectId: string, amount: number) => void;
  onRetireCredit?: (projectId: string, amount: number, reason: string) => void;
  onComplete?: (details: OnboardingCompletion) => void;
  onSkip?: () => void;
}

const STEP_NAMES = [
  "Connect Wallet",
  "Create Profile",
  "Browse Projects",
  "Buy Credit",
  "Retire & Get Certificate",
] as const;

const DEFAULT_PROJECTS: OnboardingProject[] = [
  { id: "amazon-forest", name: "Amazon Forest Protection", location: "Brazil", availableCredits: 1200 },
  { id: "coastal-restoration", name: "Coastal Restoration", location: "Kenya", availableCredits: 840 },
];

const styles = `
  .onboarding-flow {
    --onboarding-ink: var(--color-neutral-900, #111827);
    --onboarding-muted: var(--color-neutral-600, #4b5563);
    --onboarding-border: var(--color-neutral-200, #e5e7eb);
    --onboarding-surface: var(--color-surface, #ffffff);
    --onboarding-surface-alt: var(--color-surface-alt, #f9fafb);
    --onboarding-accent: var(--color-primary-600, #16a34a);
    --onboarding-accent-dark: var(--color-primary-700, #15803d);
    max-width: 720px;
    margin: 0 auto;
    color: var(--onboarding-ink);
    font-family: inherit;
  }
  .onboarding-flow__shell {
    background: var(--onboarding-surface);
    border: 1px solid var(--onboarding-border);
    border-radius: 1rem;
    box-shadow: 0 14px 35px rgb(17 24 39 / 0.09);
    overflow: hidden;
  }
  .onboarding-flow__header { padding: 1.5rem 1.5rem 1rem; }
  .onboarding-flow__eyebrow {
    color: var(--onboarding-accent-dark);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .onboarding-flow__title { margin: 0.35rem 0 0; font-size: clamp(1.5rem, 4vw, 2rem); line-height: 1.15; }
  .onboarding-flow__subtitle { color: var(--onboarding-muted); margin: 0.6rem 0 0; line-height: 1.5; }
  .onboarding-flow__progress { padding: 0 1.5rem 1.5rem; }
  .onboarding-flow__progress-track { height: 0.5rem; background: var(--onboarding-border); border-radius: 999px; overflow: hidden; }
  .onboarding-flow__progress-value { height: 100%; background: var(--onboarding-accent); border-radius: inherit; transition: width 350ms ease; }
  .onboarding-flow__steps { display: flex; justify-content: space-between; gap: 0.35rem; margin-top: 0.7rem; }
  .onboarding-flow__step-label { color: var(--onboarding-muted); font-size: 0.7rem; text-align: center; line-height: 1.25; flex: 1; }
  .onboarding-flow__step-label[data-current="true"] { color: var(--onboarding-accent-dark); font-weight: 700; }
  .onboarding-flow__content { border-top: 1px solid var(--onboarding-border); padding: 2rem 1.5rem; min-height: 280px; }
  .onboarding-flow__panel { animation: onboarding-enter 280ms ease both; }
  .onboarding-flow__panel[data-direction="back"] { animation-name: onboarding-enter-back; }
  .onboarding-flow__panel h2 { margin: 0 0 0.65rem; font-size: 1.35rem; }
  .onboarding-flow__panel p { color: var(--onboarding-muted); line-height: 1.55; margin: 0 0 1.25rem; }
  .onboarding-flow__field { display: grid; gap: 0.4rem; margin: 1rem 0; }
  .onboarding-flow__field label { font-size: 0.875rem; font-weight: 700; }
  .onboarding-flow__field input, .onboarding-flow__field select {
    width: 100%; box-sizing: border-box; border: 1px solid var(--onboarding-border); border-radius: 0.5rem;
    background: var(--onboarding-surface); color: var(--onboarding-ink); font: inherit; padding: 0.75rem;
  }
  .onboarding-flow__field input:focus, .onboarding-flow__field select:focus { outline: 3px solid color-mix(in srgb, var(--onboarding-accent) 30%, transparent); border-color: var(--onboarding-accent); }
  .onboarding-flow__wallet { background: var(--onboarding-surface-alt); border: 1px solid var(--onboarding-border); border-radius: 0.65rem; padding: 1rem; word-break: break-all; }
  .onboarding-flow__projects { display: grid; gap: 0.65rem; }
  .onboarding-flow__project { display: flex; align-items: center; gap: 0.75rem; border: 1px solid var(--onboarding-border); border-radius: 0.65rem; padding: 0.85rem; cursor: pointer; }
  .onboarding-flow__project:has(input:checked) { border-color: var(--onboarding-accent); background: color-mix(in srgb, var(--onboarding-accent) 8%, var(--onboarding-surface)); }
  .onboarding-flow__project input { accent-color: var(--onboarding-accent); }
  .onboarding-flow__project-copy { display: grid; gap: 0.2rem; }
  .onboarding-flow__project-copy small { color: var(--onboarding-muted); }
  .onboarding-flow__error { color: #b91c1c; font-size: 0.875rem; margin: 0.65rem 0 0; }
  .onboarding-flow__actions { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; border-top: 1px solid var(--onboarding-border); padding: 1rem 1.5rem; }
  .onboarding-flow__actions-right { display: flex; gap: 0.65rem; margin-left: auto; }
  .onboarding-flow button { border: 0; border-radius: 0.5rem; cursor: pointer; font: inherit; font-weight: 700; padding: 0.7rem 1rem; }
  .onboarding-flow button:focus-visible { outline: 3px solid color-mix(in srgb, var(--onboarding-accent) 40%, transparent); outline-offset: 2px; }
  .onboarding-flow__back, .onboarding-flow__skip { background: transparent; color: var(--onboarding-muted); }
  .onboarding-flow__next { background: var(--onboarding-accent); color: #fff; min-width: 6rem; }
  .onboarding-flow__next:hover { background: var(--onboarding-accent-dark); }
  .onboarding-flow__celebration { text-align: center; animation: onboarding-pop 500ms ease both; }
  .onboarding-flow__celebration-mark { display: grid; place-items: center; width: 4rem; height: 4rem; margin: 0 auto 1rem; border-radius: 50%; background: var(--onboarding-accent); color: #fff; font-size: 2rem; }
  .onboarding-flow__confetti { display: flex; justify-content: center; gap: 0.55rem; margin: 1.5rem 0 0; }
  .onboarding-flow__confetti span { width: 0.55rem; height: 1.4rem; background: var(--onboarding-accent); transform: rotate(var(--rotation)); animation: onboarding-confetti 700ms ease-in-out infinite alternate; }
  .onboarding-flow__confetti span:nth-child(2n) { background: #2775ca; }
  .onboarding-flow__confetti span:nth-child(3n) { background: #d97706; }
  @keyframes onboarding-enter { from { opacity: 0; transform: translateX(1rem); } to { opacity: 1; transform: translateX(0); } }
  @keyframes onboarding-enter-back { from { opacity: 0; transform: translateX(-1rem); } to { opacity: 1; transform: translateX(0); } }
  @keyframes onboarding-pop { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
  @keyframes onboarding-confetti { from { transform: translateY(0) rotate(var(--rotation)); } to { transform: translateY(-0.55rem) rotate(var(--rotation)); } }
  @media (prefers-reduced-motion: reduce) { .onboarding-flow *, .onboarding-flow *::before, .onboarding-flow *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
  @media (max-width: 540px) {
    .onboarding-flow__header, .onboarding-flow__content { padding: 1.25rem; }
    .onboarding-flow__progress { padding: 0 1.25rem 1.25rem; }
    .onboarding-flow__actions { padding: 0.9rem 1.25rem; }
    .onboarding-flow__step-label { font-size: 0.62rem; }
    .onboarding-flow__actions { align-items: stretch; flex-wrap: wrap; }
    .onboarding-flow__actions-right { width: 100%; margin-left: 0; }
    .onboarding-flow__actions-right button { flex: 1; }
  }
`;

export default function OnboardingFlow({
  walletAddress,
  projects = DEFAULT_PROJECTS,
  initialProfile,
  initialProjectId,
  onConnectWallet,
  onBrowseProjects,
  onBuyCredit,
  onRetireCredit,
  onComplete,
  onSkip,
}: OnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [profile, setProfile] = useState<OnboardingProfile>({ name: initialProfile?.name ?? "", email: initialProfile?.email ?? "" });
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? "");
  const [creditAmount, setCreditAmount] = useState(1);
  const [retirementReason, setRetirementReason] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  const validateStep = () => {
    if (currentStep === 0 && !walletAddress) return "Connect a wallet to continue.";
    if (currentStep === 1 && !profile.name.trim()) return "Enter your name to create a profile.";
    if (currentStep === 2 && !projectId) return "Choose a project to continue.";
    if (currentStep === 3 && (!Number.isInteger(creditAmount) || creditAmount < 1)) return "Enter at least one credit.";
    if (currentStep === 4 && !retirementReason.trim()) return "Add a reason for this retirement.";
    return "";
  };

  const goNext = () => {
    const validationError = validateStep();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    if (currentStep === 2) onBrowseProjects?.();
    if (currentStep === 3) onBuyCredit?.(projectId, creditAmount);
    if (currentStep === 4) {
      onRetireCredit?.(projectId, creditAmount, retirementReason.trim());
      setComplete(true);
      onComplete?.({ profile, projectId, creditAmount, retirementReason: retirementReason.trim() });
      return;
    }
    setDirection("forward");
    setCurrentStep((step) => step + 1);
  };

  const goBack = () => {
    setError("");
    setDirection("back");
    setCurrentStep((step) => Math.max(0, step - 1));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    goNext();
  };

  return (
    <div className="onboarding-flow">
      <style>{styles}</style>
      <div className="onboarding-flow__shell">
        <header className="onboarding-flow__header">
          <div className="onboarding-flow__eyebrow">CarbonLedger</div>
          <h1 className="onboarding-flow__title">Your climate impact, made clear.</h1>
          <p className="onboarding-flow__subtitle">A few quick steps to move from wallet connection to your first verified retirement.</p>
        </header>
        <div className="onboarding-flow__progress" aria-label={`Step ${complete ? 5 : currentStep + 1} of 5`}>
          <div className="onboarding-flow__progress-track" role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={complete ? 5 : currentStep + 1}>
            <div className="onboarding-flow__progress-value" style={{ width: `${((complete ? 5 : currentStep + 1) / 5) * 100}%` }} />
          </div>
          <div className="onboarding-flow__steps" aria-hidden="true">
            {STEP_NAMES.map((name, index) => <span className="onboarding-flow__step-label" data-current={!complete && currentStep === index} key={name}>{name}</span>)}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <main className="onboarding-flow__content" aria-live="polite">
            {complete ? (
              <div className="onboarding-flow__celebration" role="status">
                <div className="onboarding-flow__celebration-mark" aria-hidden="true">✓</div>
                <h2>Retirement complete</h2>
                <p>Your certificate is ready. You have taken a permanent, verifiable climate action.</p>
                <div className="onboarding-flow__confetti" aria-hidden="true">
                  {["-12deg", "8deg", "-4deg", "14deg", "-10deg", "5deg"].map((rotation, index) => <span key={index} style={{ "--rotation": rotation } as React.CSSProperties} />)}
                </div>
              </div>
            ) : (
              <div className="onboarding-flow__panel" data-direction={direction} key={currentStep}>
                {currentStep === 0 && <><h2>Connect your wallet</h2><p>Use your Stellar wallet to securely own and retire verified credits.</p>{walletAddress ? <div className="onboarding-flow__wallet" aria-label="Connected wallet">Connected: {walletAddress}</div> : <button className="onboarding-flow__next" type="button" onClick={onConnectWallet}>Connect Wallet</button>}</>}
                {currentStep === 1 && <><h2>Create your profile</h2><p>Tell us who should appear on your retirement certificate.</p><div className="onboarding-flow__field"><label htmlFor="onboarding-name">Name</label><input id="onboarding-name" value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} autoComplete="name" /></div><div className="onboarding-flow__field"><label htmlFor="onboarding-email">Email (optional)</label><input id="onboarding-email" type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} autoComplete="email" /></div></>}
                {currentStep === 2 && <><h2>Browse verified projects</h2><p>Choose a project with a story you want to support.</p><div className="onboarding-flow__projects">{projects.map((project) => <label className="onboarding-flow__project" key={project.id}><input type="radio" name="onboarding-project" value={project.id} checked={projectId === project.id} onChange={() => setProjectId(project.id)} /><span className="onboarding-flow__project-copy"><strong>{project.name}</strong><small>{project.location ?? "Verified project"}{project.availableCredits ? ` · ${project.availableCredits.toLocaleString()} credits available` : ""}</small></span></label>)}</div></>}
                {currentStep === 3 && <><h2>Buy your first credit</h2><p>Credits represent one tonne of verified carbon dioxide equivalent.</p><div className="onboarding-flow__field"><label htmlFor="onboarding-amount">Credit amount</label><input id="onboarding-amount" type="number" min="1" step="1" value={creditAmount} onChange={(event) => setCreditAmount(Number(event.target.value))} /></div></>}
                {currentStep === 4 && <><h2>Retire and get your certificate</h2><p>Retirement permanently removes credits from circulation and creates a verifiable certificate.</p><div className="onboarding-flow__field"><label htmlFor="onboarding-reason">Retirement reason</label><input id="onboarding-reason" value={retirementReason} onChange={(event) => setRetirementReason(event.target.value)} placeholder="e.g. 2026 sustainability commitment" /></div></>}
                {error && <p className="onboarding-flow__error" role="alert">{error}</p>}
              </div>
            )}
          </main>
          {!complete && <footer className="onboarding-flow__actions"><button type="button" className="onboarding-flow__skip" onClick={onSkip}>Skip setup</button><div className="onboarding-flow__actions-right">{currentStep > 0 && <button type="button" className="onboarding-flow__back" onClick={goBack}>Back</button>}<button type="submit" className="onboarding-flow__next">{currentStep === 4 ? "Retire credits" : "Next"}</button></div></footer>}
        </form>
      </div>
    </div>
  );
}
