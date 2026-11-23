/**
 * Cheap, deterministic Clippy replies for small talk. A message is answered locally only when the whole
 * message (lowercased, punctuation and extra spaces removed) equals a known phrase. Anything longer or
 * mixed with a request, such as "hi, create a folder", goes to the AI as usual.
 */

/** Clippy animations used by Small talk replies. All exist in public/clippy/agent.json. */
export type SmallTalkAnimation = 'Greeting' | 'GoodBye' | 'Congratulate' | 'Explain' | 'Wave' | 'GetAttention';

export type SmallTalkIntent =
  | 'greeting'
  | 'thanks'
  | 'goodbye'
  | 'praise'
  | 'capabilities'
  | 'identity'
  | 'acknowledgement'
  | 'laughter';

export interface SmallTalkReply {
  intent: SmallTalkIntent;
  text: string;
  animation: SmallTalkAnimation;
}

interface IntentDef {
  phrases: string[];
  animation: SmallTalkAnimation;
  replies: string[];
}

const CAPABILITIES = [
  "Here's what I can do:",
  '',
  '- Files and folders: "Create a folder called Projects in My Documents"',
  '- Documents: "Write a report on AI with a section on data centers"',
  '- Search: "Find files about invoices"',
  '- Pictures: "Draw a red house in Paint" or "Generate an image of a sunset"',
  '- Organize: "Organize the files on my desktop"',
  '- Delete: "Delete old-notes.txt" (it goes to the Recycle Bin, and I ask first)',
  '',
  'What would you like to do?',
].join('\n');

export const INTENTS: Record<SmallTalkIntent, IntentDef> = {
  greeting: {
    phrases: ['hi', 'hello', 'hey', 'good morning', 'good day', 'good afternoon', 'good evening', 'hello clippy', 'hi clippy', 'hey clippy'],
    animation: 'Greeting',
    replies: [
      'Hi! What are we working on?',
      'Hey there. What can I do for you?',
      'Hello! Need a hand with something?',
      "Hi. Tell me what you need and I'll get it done.",
    ],
  },
  thanks: {
    phrases: ['thanks', 'thank you', 'thx', 'ty', 'thanks clippy', 'thank you clippy'],
    animation: 'Congratulate',
    replies: [
      'Anytime. Let me know if you need anything else.',
      "You got it. What's next?",
      'No problem.',
      'Glad that worked. Anything else?',
    ],
  },
  goodbye: {
    phrases: ['bye', 'bye bye', 'goodbye', 'see you', 'see you soon', 'cya', 'bye clippy', 'goodbye clippy'],
    animation: 'GoodBye',
    replies: [
      "See you later! I'll be here if you need me.",
      'Bye bye!',
      'Take care. Come back anytime.',
      'Catch you later!',
      'See you soon!',
    ],
  },
  praise: {
    phrases: ['good job', 'well done', 'nice', 'great', 'awesome', 'nice job', 'great job', 'good work'],
    animation: 'Congratulate',
    replies: [
      'Thanks! Glad it worked out.',
      "Appreciate it. Let me know what's next.",
      'Happy to help. Anything else on the list?',
      'Thanks! Ready for the next one.',
    ],
  },
  capabilities: {
    phrases: ['what can you do', 'what do you do', 'help', 'what can you do for me', 'what can clippy do'],
    animation: 'Explain',
    replies: [CAPABILITIES],
  },
  identity: {
    phrases: ['who are you', 'who is this', 'what are you'],
    animation: 'Wave',
    replies: [
      `I'm Clippy, your assistant on this desktop. I can manage files, write documents, draw, search and tidy up. Ask "what can you do" for examples.`,
      "I'm Clippy. I can create folders and documents, generate images, search your files and organize them. Just tell me what you need.",
      "I'm Clippy. I do the clicking for you: files, documents, drawings, search. Just ask.",
    ],
  },
  acknowledgement: {
    phrases: ['ok', 'okay'],
    animation: 'GetAttention',
    replies: [
      "Got it. Tell me when you're ready for the next thing.",
      "Okay. I'm here if you need me.",
      'Sounds good.',
    ],
  },
  laughter: {
    phrases: ['lol'],
    animation: 'Wave',
    replies: [
      'Ha! Anything I can help with?',
      "Glad that landed. What's next?",
      'Ha. Let me know if you need me.',
    ],
  },
};
/** Lowercase, drop punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PHRASE_TO_INTENT = new Map<string, SmallTalkIntent>();
for (const [intent, def] of Object.entries(INTENTS) as [SmallTalkIntent, IntentDef][]) {
  for (const p of def.phrases) PHRASE_TO_INTENT.set(p, intent);
}

/**
 * Returns a small talk reply when the whole message is a known phrase, otherwise null.
 * `rand` returns a number in [0, 1) and is injectable so tests can pick a specific variant.
 */
export function matchSmallTalk(text: string, rand: () => number = Math.random): SmallTalkReply | null {
  const intent = PHRASE_TO_INTENT.get(normalize(text));
  if (!intent) return null;
  const def = INTENTS[intent];
  const index = Math.min(def.replies.length - 1, Math.floor(rand() * def.replies.length));
  return { intent, text: def.replies[index] as string, animation: def.animation };
}
