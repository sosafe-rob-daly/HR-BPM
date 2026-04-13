import type { Message, Source, MessageFlag } from './types/chat';

interface MockResponse {
  content: string;
  topic: string;
  sources?: Source[];
  flags?: MessageFlag[];
}

const responses: { pattern: RegExp; response: MockResponse }[] = [
  {
    pattern: /pip|performance improvement|underperform/i,
    response: {
      topic: 'Performance improvement process',
      content: `Here's how the PIP process works at SoSafe:

1. Document specific, measurable performance gaps with your HRBP
2. Draft a PIP plan with clear goals, timeline (typically 4–6 weeks), and support measures
3. Hold a formal PIP kickoff meeting with the team member — your HRBP should attend
4. Schedule weekly check-ins to track progress against the plan
5. At the end of the PIP period, evaluate with your HRBP and decide next steps

Before starting a PIP, make sure you've already had at least one documented feedback conversation. A PIP should never be the first time someone hears there's a concern.`,
      sources: [
        { title: 'Performance Management – Confluence', lastUpdated: 'Jan 2026' },
      ],
      flags: [
        { type: 'time-sensitive', label: 'Verify current PIP template with your HRBP — last updated Jan 2026' },
      ],
    },
  },
  {
    pattern: /feedback|difficult conversation|tough talk/i,
    response: {
      topic: 'Difficult feedback conversation',
      content: `Preparing for a difficult feedback conversation — here's a framework:

Situation: Describe the specific behaviour or event objectively
Impact: Explain how it affected the team, project, or outcomes
Expectation: State what you need to see going forward
Support: Ask what they need from you to get there

Tips:
- Lead with curiosity, not conclusions — ask for their perspective first
- Stick to observable facts, not character judgments
- Keep it private and timely (within a few days of the event)
- Prepare for emotional reactions — pause, acknowledge, continue

If the situation involves potential legal risk, discrimination concerns, or you're unsure how to proceed, loop in your HRBP before the conversation.`,
      sources: [
        { title: 'Leadership Conversations Guide – Confluence' },
      ],
    },
  },
  {
    pattern: /leave|absence|sick|parental/i,
    response: {
      topic: 'Absence & leave management',
      content: `For leave and absence questions, here's the general framework:

- Sick leave: Team members should notify you and log it in Personio. For extended sick leave (>3 days), a doctor's note is required.
- Parental leave: Entitlements vary by country. In Germany, employees can take up to 3 years of Elternzeit. Encourage team members to discuss their plans early so you can plan coverage.
- Special leave: Bereavement, moving, marriage — check Personio for the specific entitlements.

As a manager, your role is to acknowledge the absence, ensure proper documentation, and plan for coverage — not to question the reason.`,
      sources: [
        { title: 'Leave Policy – Confluence', lastUpdated: 'Mar 2026' },
        { title: 'Personio Help Center' },
      ],
      flags: [
        { type: 'time-sensitive', label: 'Leave entitlements may change — verify current policy in Personio or with HRBP' },
      ],
    },
  },
  {
    pattern: /probation/i,
    response: {
      topic: 'Probation period management',
      content: `During the probation period (typically 6 months in Germany):

- Schedule regular 1:1s — at least every 2 weeks
- Give clear, documented feedback early. Don't wait for the 5-month mark.
- If you have concerns, raise them with your HRBP by month 3 at the latest
- A probation extension or termination during probation has a shorter notice period, but must be handled with your HRBP

The goal of probation is mutual evaluation — it should feel supportive, not adversarial. If you're seeing warning signs, act early.`,
      sources: [
        { title: 'Onboarding & Probation – Confluence', lastUpdated: 'Nov 2025' },
      ],
      flags: [
        { type: 'escalate', label: 'Probation decisions require HRBP involvement — please loop them in' },
      ],
    },
  },
];

const fallback: MockResponse = {
  topic: 'General HR guidance',
  content: `Thanks for describing that situation. Here's my initial take:

This sounds like something where a few things could apply. To give you the most relevant guidance, could you tell me:

1. How long has this been going on?
2. Have you already had a conversation with the team member about it?
3. Is there any documented history (emails, previous feedback, Personio notes)?

In the meantime, the general principle: document early, communicate directly, and involve your HRBP before making any formal decisions. You don't need to have all the answers — that's what the partnership is for.`,
  sources: [],
};

let nextId = 1;

export function generateMockResponse(userMessage: string): { message: Message; topic: string } {
  const match = responses.find((r) => r.pattern.test(userMessage));
  const resp = match?.response ?? fallback;

  return {
    message: {
      id: `agent-${nextId++}`,
      role: 'agent',
      content: resp.content,
      timestamp: new Date(),
      sources: resp.sources,
      flags: resp.flags,
    },
    topic: resp.topic,
  };
}
