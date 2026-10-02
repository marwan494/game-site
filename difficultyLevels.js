'use strict';

/**
 * Difficulty ladder with progressively stronger engine settings — and the
 * ONLY place ELO ratings still live in this bot (player ELO was removed;
 * only bots are rated now). Stockfish's own UCI_Elo limiter bottoms out
 * around 1320, so the two lowest tiers are approximated by mixing in
 * random legal moves and capping search depth — this reproduces
 * believable, human-like beginner mistakes rather than "perfect play,
 * but slower". From "هاوٍ" upward, real engine strength (UCI_LimitStrength
 * / UCI_Elo, or full strength for the top tier) does the work, and both
 * search time and depth grow with the tier so higher-ELO bots are not
 * just "rated higher" on paper but are measurably harder to beat.
 */
const LEVELS = [
  {
    id: 1,
    key: 'beginner',
    label: 'مبتدئ',
    elo: 450,
    description: 'مثالي لأول لعبة — أخطاء كثيرة ومتوقعة',
    randomness: 0.6,
    engine: { movetimeMs: 150, depth: 1 },
  },
  {
    id: 2,
    key: 'novice',
    label: 'مبتدئ متقدم',
    elo: 700,
    description: 'يعرف القواعد لكن يخطئ كثيرًا في التكتيك',
    randomness: 0.38,
    engine: { movetimeMs: 220, depth: 2 },
  },
  {
    id: 3,
    key: 'casual',
    label: 'هاوٍ',
    elo: 1000,
    description: 'لعب مقبول، يفوّت التكتيكات المعقدة',
    randomness: 0.15,
    engine: { movetimeMs: 350, skillLevel: 4 },
  },
  {
    id: 4,
    key: 'intermediate',
    label: 'متوسط',
    elo: 1350,
    description: 'خصم متوازن لمعظم اللاعبين',
    randomness: 0.05,
    engine: { movetimeMs: 600, elo: 1350 },
  },
  {
    id: 5,
    key: 'advanced',
    label: 'متقدم',
    elo: 1650,
    description: 'يخطط جيدًا ويستغل الأخطاء',
    randomness: 0.015,
    engine: { movetimeMs: 900, elo: 1650 },
  },
  {
    id: 6,
    key: 'strong',
    label: 'قوي',
    elo: 1950,
    description: 'مستوى نادٍ — يحتاج لعبًا دقيقًا لمجاراته',
    randomness: 0,
    engine: { movetimeMs: 1200, elo: 1950 },
  },
  {
    id: 7,
    key: 'expert',
    label: 'خبير',
    elo: 2300,
    description: 'مستوى بطولي — يعاقب أي خطأ فورًا',
    randomness: 0,
    engine: { movetimeMs: 1600, elo: 2300 },
  },
  {
    id: 8,
    key: 'master',
    label: 'أستاذ',
    elo: 2700,
    description: 'قوة عظمى — للاعبين الجادّين فقط',
    randomness: 0,
    engine: { movetimeMs: 2100, elo: 2700 },
  },
  {
    id: 9,
    key: 'legendary',
    label: 'أسطوري (بدون حدود)',
    elo: 3200,
    description: 'قوة المحرك كاملة — شبه مستحيل الفوز عليه',
    randomness: 0,
    engine: { movetimeMs: 2500 }, // no elo cap => full strength
  },
];

function getLevel(id) {
  return LEVELS.find((l) => l.id === Number(id));
}

module.exports = { LEVELS, getLevel };
