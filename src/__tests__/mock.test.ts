import { describe, it, expect } from 'vitest';
import { generateMockResponse } from '../mock';

describe('generateMockResponse', () => {
  it('returns a PIP-related response for PIP keywords', () => {
    const { message, topic } = generateMockResponse('How do I start a PIP?');
    expect(topic).toBe('Performance improvement process');
    expect(message.role).toBe('agent');
    expect(message.content).toContain('PIP');
    expect(message.sources).toBeDefined();
    expect(message.sources!.length).toBeGreaterThan(0);
  });

  it('returns a feedback response for difficult conversation keywords', () => {
    const { topic } = generateMockResponse('Preparing for a tough talk');
    expect(topic).toBe('Difficult feedback conversation');
  });

  it('returns a leave response for absence keywords', () => {
    const { message, topic } = generateMockResponse('Team member on sick leave');
    expect(topic).toBe('Absence & leave management');
    expect(message.flags).toBeDefined();
  });

  it('returns a probation response with escalation flag', () => {
    const { message } = generateMockResponse('What about probation?');
    expect(message.flags).toBeDefined();
    expect(message.flags!.some((f) => f.type === 'escalate')).toBe(true);
  });

  it('returns a fallback for unrecognized input', () => {
    const { topic } = generateMockResponse('something completely different');
    expect(topic).toBe('General HR guidance');
  });
});
