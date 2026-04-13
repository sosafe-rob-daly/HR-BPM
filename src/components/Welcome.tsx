interface WelcomeProps {
  onPrompt: (text: string) => void;
}

const starters = [
  'How do I start a PIP?',
  'Preparing for a difficult feedback conversation',
  'Team member requesting extended leave',
  'Handling underperformance before probation ends',
];

export default function Welcome({ onPrompt }: WelcomeProps) {
  return (
    <div className="welcome">
      <h2>What situation can I help with?</h2>
      <p>
        Describe what's happening with your team member in plain language. I'll
        give you relevant policy guidance, coaching tips, and let you know when
        to loop in your HRBP.
      </p>
      <div className="welcome-prompts">
        {starters.map((s) => (
          <button key={s} className="welcome-prompt" onClick={() => onPrompt(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
