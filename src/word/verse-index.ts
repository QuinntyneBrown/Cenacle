import type { MatchResult, Passage } from "../core/types";

const PASSAGES: Passage[] = [
  {
    id: "isaiah-41-10",
    reference: "Isaiah 41:10",
    text: "Don't you be afraid, for I am with you. Don't be dismayed, for I am your God. I will strengthen you. Yes, I will help you. Yes, I will uphold you with the right hand of my righteousness.",
    contextUrl: "https://www.biblegateway.com/passage/?search=Isaiah%2041&version=WEB",
    themes: ["fear", "afraid", "anxiety", "courage", "strength"]
  },
  {
    id: "psalm-46-1-3",
    reference: "Psalm 46:1–3",
    text: "God is our refuge and strength, a very present help in trouble. Therefore we won't be afraid, though the earth changes, though the mountains are shaken into the heart of the seas.",
    contextUrl: "https://www.biblegateway.com/passage/?search=Psalm%2046&version=WEB",
    themes: ["trouble", "fear", "refuge", "strength", "change"]
  },
  {
    id: "lamentations-3-25-26",
    reference: "Lamentations 3:25–26",
    text: "Yahweh is good to those who wait for him, to the soul who seeks him. It is good that a man should hope and quietly wait for the salvation of Yahweh.",
    contextUrl: "https://www.biblegateway.com/passage/?search=Lamentations%203&version=WEB",
    themes: ["waiting", "patience", "hope", "silence"]
  },
  {
    id: "philippians-4-6-7",
    reference: "Philippians 4:6–7",
    text: "In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God. And the peace of God, which surpasses all understanding, will guard your hearts and your thoughts in Christ Jesus.",
    contextUrl: "https://www.biblegateway.com/passage/?search=Philippians%204&version=WEB",
    themes: ["anxiety", "peace", "prayer", "gratitude", "worry"]
  },
  {
    id: "psalm-34-18",
    reference: "Psalm 34:18",
    text: "Yahweh is near to those who have a broken heart, and saves those who have a crushed spirit.",
    contextUrl: "https://www.biblegateway.com/passage/?search=Psalm%2034&version=WEB",
    themes: ["grief", "loss", "lament", "heartbreak", "sadness"]
  },
  {
    id: "matthew-6-31-33",
    reference: "Matthew 6:31–33",
    text: "Therefore don't be anxious, saying, ‘What will we eat?’, ‘What will we drink?’ or, ‘With what will we be clothed?’ But seek first God's Kingdom and his righteousness; and all these things will be given to you as well.",
    contextUrl: "https://www.biblegateway.com/passage/?search=Matthew%206&version=WEB",
    themes: ["provision", "money", "need", "worry", "trust"]
  },
  {
    id: "colossians-3-13",
    reference: "Colossians 3:13",
    text: "Bear with each other, and forgive each other, if any man has a complaint against any; even as Christ forgave you, so you also do.",
    contextUrl: "https://www.biblegateway.com/passage/?search=Colossians%203&version=WEB",
    themes: ["forgiveness", "conflict", "mercy", "relationship"]
  },
  {
    id: "1-thessalonians-5-16-18",
    reference: "1 Thessalonians 5:16–18",
    text: "Always rejoice. Pray without ceasing. In everything give thanks, for this is the will of God in Christ Jesus toward you.",
    contextUrl: "https://www.biblegateway.com/passage/?search=1%20Thessalonians%205&version=WEB",
    themes: ["gratitude", "joy", "thanksgiving", "prayer"]
  }
];

const ALIASES: Record<string, string[]> = {
  afraid: ["fear"], anxious: ["anxiety", "worry"], lonely: ["grief", "sadness"],
  job: ["provision", "work"], finances: ["money", "provision"], thanks: ["gratitude", "thanksgiving"],
  angry: ["forgiveness", "conflict"], wait: ["waiting", "patience"]
};

function tokens(value: string): string[] {
  return value.toLocaleLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export class VerseIndex {
  lookup(theme: string): Passage[] {
    const sought = new Set(tokens(theme).flatMap((token) => [token, ...(ALIASES[token] ?? [])]));
    return PASSAGES
      .map((passage) => ({ passage, score: passage.themes.reduce((sum, item) => sum + Number(sought.has(item)), 0) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ passage }) => passage);
  }
}

export class PassageMatcher {
  constructor(private readonly index = new VerseIndex()) {}

  surface(theme: string, exclude: string[] = []): MatchResult {
    const passage = this.index.lookup(theme).find((item) => !exclude.includes(item.id));
    return passage
      ? { matched: true, passage, suggestions: [] }
      : { matched: false, suggestions: ["fear", "waiting", "grief", "forgiveness", "gratitude", "provision"] };
  }
}

export const quickThemes = ["fear", "gratitude", "waiting", "forgiveness", "grief", "provision"];
