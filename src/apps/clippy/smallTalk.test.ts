import { describe, expect, it } from 'vitest';
import { INTENTS, matchSmallTalk, normalize, type SmallTalkIntent } from './smallTalk';

describe('normalize', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalize('  Thank   YOU!!  ')).toBe('thank you');
    expect(normalize("What can you do?")).toBe('what can you do');
  });
});

describe('matchSmallTalk', () => {
  const cases = Object.entries(INTENTS).flatMap(([intent, def]) => def.phrases.map((p) => [intent, p] as const));

  it.each(cases)('%s: matches "%s"', (intent, phrase) => {
    expect(matchSmallTalk(phrase)?.intent).toBe(intent);
  });

  it('covers every requested phrase', () => {
    const wanted: Record<SmallTalkIntent, string[]> = {
      greeting: ['hi', 'hello', 'hey', 'good morning', 'good day', 'good evening', 'hello clippy'],
      thanks: ['thanks', 'thank you', 'thx', 'ty'],
      goodbye: ['bye', 'bye bye', 'goodbye', 'see you', 'see you soon', 'cya'],
      praise: ['good job', 'well done', 'nice', 'great', 'awesome'],
      capabilities: ['what can you do', 'help', 'what do you do'],
      identity: ['who are you'],
      acknowledgement: ['ok', 'okay'],
      laughter: ['lol'],
    };
    for (const [intent, phrases] of Object.entries(wanted)) {
      for (const p of phrases) expect(matchSmallTalk(p)?.intent, p).toBe(intent);
    }
  });

  it('ignores case, punctuation and spacing', () => {
    expect(matchSmallTalk('Thank you!')?.intent).toBe('thanks');
    expect(matchSmallTalk('  HELLO,   Clippy... ')?.intent).toBe('greeting');
    expect(matchSmallTalk('What can you do?')?.intent).toBe('capabilities');
    expect(matchSmallTalk('Good job!!!')?.intent).toBe('praise');
  });

  it('returns null for requests that only start or end with a phrase', () => {
    for (const t of [
      'hi, create a folder',
      'thanks, now delete it',
      'ok create a folder',
      'help me write a report',
      'bye the way, list my files',
      'Create a folder called AI Research in My Documents',
      '',
      '   ',
      '!!!',
    ]) {
      expect(matchSmallTalk(t), t).toBeNull();
    }
  });

  it('uses the injected random source to pick a variant', () => {
    const variants = INTENTS.greeting.replies;
    expect(matchSmallTalk('hi', () => 0)?.text).toBe(variants[0]);
    expect(matchSmallTalk('hi', () => 0.999)?.text).toBe(variants[variants.length - 1]);
    expect(matchSmallTalk('hi', () => 1)?.text).toBe(variants[variants.length - 1]);
  });

  it('has 3 to 5 non-empty variants per intent (capabilities has one)', () => {
    for (const [intent, def] of Object.entries(INTENTS)) {
      if (intent === 'capabilities') expect(def.replies).toHaveLength(1);
      else {
        expect(def.replies.length, intent).toBeGreaterThanOrEqual(3);
        expect(def.replies.length, intent).toBeLessThanOrEqual(5);
      }
      for (const r of def.replies) expect(r.trim().length).toBeGreaterThan(0);
    }
  });

  it('capabilities reply includes example prompts', () => {
    const text = matchSmallTalk('what can you do')?.text ?? '';
    expect(text).toContain('Create a folder called Projects in My Documents');
    expect(text).toContain('Find files about invoices');
  });

  it('uses no emoji', () => {
    for (const def of Object.values(INTENTS)) for (const r of def.replies) expect(r).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
