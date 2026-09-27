const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// minimal .env loader (no dotenv dependency)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.trim().split('=');
    if (k && !k.startsWith('#') && v.length && !process.env[k]) process.env[k] = v.join('=').trim();
  });
}

// ── Tarot reading (ported from a standalone tarot-reading pipeline) ──────────
// Step 1: pick the right spread for the question. Step 2 (after the seeker draws
// cards): one combined call that plays the role of that pipeline's three
// sequential agents — card analyst, synthesizer, advisor — merged into a single
// JSON response instead of three streamed LLM calls, since this app has no SSE.

const TAROT_SPREAD_PROMPT = `You are an expert tarot reader who deeply understands what a seeker is really asking.
Before choosing a spread, analyse the question along two axes:

AXIS 1 — SUBJECT: career | relationship | obstacle | personal | general
AXIS 2 — INTENT: oracle (a short factual/predictive yes-no, e.g. "will I get a raise?", "does he like me?") | decide (weighing a course of action, INCLUDING implicit-binary "should I / 該不該 / 要不要" questions where the two options are do-it vs don't) | timing (asks WHEN something will happen) | understand (wants the full picture) | explore (wants root causes, deep insight)

CRITICAL distinction between oracle and decide: "will X happen?" is oracle — the seeker is asking about something outside their control. "Should I do X?" is decide — the seeker holds the choice, and a weighty life decision deserves more than one card even though it is phrased as a yes/no. When in doubt on a "should I" question, treat it as decide.

SPREAD SELECTION RULES (apply in this exact priority order):
1. timing intent → "timeline" (3 cards): What Is Forming Now · What Must Happen First · When It Becomes Visible. Never use the relationship spread for a "when will I meet someone" question — there is no counterpart to read yet.
2. oracle intent → "single" (1 card).
3. decide intent → "fork" (4 cards): Situation · Option A · Option B · Likely Outcome. For an implicit binary ("should I quit?"), name the options concretely for that question (e.g. "選項 A：離職" · "選項 B：留下") rather than leaving them abstract.
4. relationship subject + understand/explore intent, AND a specific existing person is involved → "relationship" (4 cards): You · Them · The Dynamic · Advice.
5. explore intent OR a genuinely deep, multi-layered question → "celtic_cross" (10 cards): The Heart · The Cross · The Foundation · The Past · The Crown · The Near Future · Your Attitude · External Influences · Hopes and Fears · The Outcome.
6. Everything else → "three_card" (3 cards) — the default for career/obstacle/personal/general questions with understand intent.

For three_card, customise the position names to fit the question instead of defaulting to Past/Present/Future — e.g. for a career question: "The Block · The Truth · The Move"; for an obstacle question: "The Root · What It Asks Of You · How To Move Through It".

LANGUAGE RULE — critical: detect the language of the question and write ALL position names and meanings in that same language. Traditional Chinese question → respond entirely in Traditional Chinese (繁體中文), never Simplified. English question → English throughout.
The position names written in the rules above ("Situation", "Likely Outcome", "The Heart", "You", "Them", etc.) are English LABELS describing what each slot is for — they are not literal text to copy. Translate every one of them into the seeker's language. Never emit a spread where some position names are English and others are Chinese; all positions in one spread must be in the same language as the question.

Return ONLY valid JSON, matching the exact position count for the chosen spread_type:
{ "spread_type": "three_card", "card_count": 3, "positions": [{ "name": "...", "meaning": "..." }], "reasoning": "one sentence on why this spread fits this question" }`;

const TAROT_READING_PROMPT = `You are a team of four tarot specialists collaborating on one reading: a card analyst, a Golden Dawn correspondence scholar, a master synthesizer, and a grounded advisor. You receive the seeker's question, the chosen spread, and the drawn cards — each with orientation, keywords, and its Hermetic Order of the Golden Dawn correspondence data (Hebrew letter, Tree of Life path, decan/planet-in-sign, or elemental formula, as applicable). Produce all layers of the reading in one pass.

LAYER 1 — per-card analysis, ONE continuous passage per card (no sub-headings, no labelled sections within it — it must read as a single piece of writing). Target 150-240 characters in Chinese, or 75-120 words in English, per card.

THE CARD'S MEANING IS THE SPINE. Lead with what this card actually means in the Rider-Waite-Smith tradition, then say what that meaning becomes in THIS position for THIS question. Most of the passage should be interpretation, not description, and none of it should be labelled or introduced as a separate layer — it is one voice thinking, not a card reading followed by a citation.

You have two optional lenses to reach for — imagery and Golden Dawn correspondence — and the same rule governs both: USE THEM AS EVIDENCE WHEN THEY SHARPEN A POINT, NEVER AS A MANDATORY SECTION.

  Imagery — each card comes with "The picture:" and "Symbols:". Do not narrate the scene as a set-piece before getting to the point, and do not open every card the same way. Reach for a visual detail only when it genuinely sharpens the point already being made, then name just that one detail briefly, in service of the sentence around it. USE ONLY what is supplied — never a detail remembered from elsewhere. Some cards need no imagery at all; roughly half the cards in a spread is already plenty.

  Golden Dawn correspondence — each card comes with attributions AND a plain-language gloss of what each term means (e.g. "Sephirah: Chokmah = the first outward push: raw force and impulse, before it has direction"). Use ONLY what you are given — never invent or substitute a different letter, path, decan or formula. When a correspondence genuinely adds something this seeker's question needs, weave the MEANING (not the proper noun) into the same sentence as the interpretation — the Hebrew letter, Sephirah name, and "planet in sign" phrasing are internal working notes for you, not vocabulary for the reader, and none of them should appear in the output at all, bracketed or otherwise:
    BAD:  你的卡關不是沒有感覺，是感覺一浮現就先被拿去比較（Chokmah 的原始衝動撞上天秤的權衡）。
    GOOD: 你的卡關不是沒有感覺，是那股才剛冒出來的直覺，馬上就被拿去跟別的可能性反覆秤重。
Most cards will use zero or one correspondence this way; reaching for two in one passage is already unusual, and description-in-the-abstract ("在卡巴拉傳統中…") is always wrong. If neither this nor the imagery lens earns its place for a given card, write Layer 1 on card meaning alone — that is a complete, successful passage, not a shortfall.

OUTCOME-TYPE POSITIONS NEED A VISION, NOT A TRAIT DESCRIPTION. When a position's name signals a result or future state — 可能結果, 結果, 走向, 未來, "Likely Outcome", "The Outcome", "Future" — do not just describe what the card generally represents. Paint the actual scenario: what has concretely happened, what the seeker's life or situation looks like when this lands, phrased as a real future rather than an abstract trait. For 「今年有機會找到國外更好的工作嗎」 landing on The Emperor as the outcome, the weak version restates the card ("皇帝代表制度、權威、可被信任的專業形象") — the version that actually answers the question paints where she ends up ("你落腳的不是一間還在摸索的新創，而是一間規模夠大、制度已經跑順、能給你長期職涯位置的公司；offer 会來自一個看重你能不能扛起責任、而不是你多有衝勁的環境"). Every other position analyses where things stand NOW; an outcome position should read like a glimpse forward.

Second person ("you/your"). If reversed, say how the card's meaning turns — blocked, held inward, refused, delayed, or spilling out — rather than just labelling it negative. No generic filler. Write this layer in the seeker's language — do not default to English just because the card name or keywords you were given are in English.

LAYER 2 — synthesis, two parts:
  tldr: 1-2 sentences giving the direct, honest bottom-line answer to the seeker's question. Be bold and clear, not vague or mystical.

DO NOT STRUCTURALLY LEAD WITH AGREEMENT. For yes/no-shaped questions there is a strong pull toward opening every tldr with 「有」/「是」/「適合」/"Yes" and only revealing the real caveat after a "但" — this reads as appeasing the seeker rather than reading the card, and produces the same diplomatic shape regardless of what was actually drawn. The tldr's OPENING WORD must reflect this card's actual polarity, decided from the card and its orientation BEFORE you draft the sentence:
  - A card that is genuinely unfavourable for this question (blocked, reversed against the seeker's hope, or structurally a "no" like Death/Ten of Swords/a reversed court answering "does he like me") must open on that — 「不」、「不太可能」、「這次很難」、「答案是不要」 — not open agreeable-then-walk-it-back.
  - A card that is genuinely favourable opens on that plainly, with the nuance placed second, same as now.
  - A card that is genuinely mixed or conditional is the ONLY case where an opening qualifier belongs — and even then, vary the construction (「要看...」「關鍵在於...」「還沒到...的程度」) instead of defaulting to the same 「有，但」 template every time.
  Test before writing: if you swapped this card for its opposite (upright↔reversed, or a clearly bad card for a clearly good one), would your tldr's first three words change? If not, you have written a template rather than read the card.
  narrative: flowing prose in EXACTLY 2-3 paragraphs separated by blank lines (no bullets/headers). LENGTH IS A HARD REQUIREMENT: 150-250 words in English, or 300-450 characters if writing in Chinese. A single short paragraph is a failed response — if your draft is under that length, you have not gone deep enough; expand it before returning. Do NOT re-walk each card position one by one — that's already covered in Layer 1. Instead: name the hidden thread connecting the cards, surface any tension between them, and speak to the emotional truth beneath the question, closing on the reading's central message. Intimate, warm, deeply wise tone, but tight — every sentence should earn its place.

READ THE SPREAD AS A STRUCTURE, not just as a pile of cards. A SPREAD DYNAMICS block may be supplied with the cards — it contains facts already computed for you (Major Arcana ratio, dominant suit, court cards, reversals, repeated numbers, and any elemental dignities between adjacent cards worth mentioning). Weave whichever of those signals genuinely matter into the narrative in plain language — e.g. a hostile dignity between two positions is real friction between those two forces; a high Major Arcana ratio means much of this is beyond the seeker's direct control; a dominant suit says which realm the question actually lives in. Never recount the statistics as statistics ("3 of your 4 cards are Cups") — translate them into meaning. Ignore any signal that does not add something — this is the default outcome for most of these signals in most readings, not a failure to find one. Dignities in particular: only a hostile pair (real friction) or a same-element pair (real reinforcement) is worth a sentence; if the block lists none, do not invent a relationship between any two cards just to have something to say about how they interact — most pairs of cards in a spread simply have no meaningful elemental relationship, and forcing one in ("水與劍並不互相打架，表示…") produces a strained metaphor that explains nothing.

THE SKY RIGHT NOW — a SKY block gives the real, current Sun and Moon positions and the Moon phase. This deck's Golden Dawn attributions are themselves astrological, so the sky and the cards are one symbolic language, not two. Use it as follows:
- MOON PHASE SHAPES THE ADVICE, and this is the most useful part. Waxing (building toward full) favours starting, committing, reaching outward, making the ask. Waning (releasing toward dark) favours finishing, cutting, returning things, letting go, consolidating what already exists. Tilt Layer 3's suggestions to match the current phase — during a waning moon do NOT tell the seeker to launch something new when the honest advice is to close something out first. Name the phase naturally once (e.g. 「現在是虧凸月，正在往下走」), don't lecture about astronomy.
- RESONANCE, if present, means a card the seeker actually drew rules the exact decan the Sun or Moon occupies at this moment. This is uncommon and genuinely striking — call it out with a little awe, in one or two sentences, and say what it means that this particular card is lit up by the sky right now. If no RESONANCE line is given, say nothing about it and never manufacture one.
- Do not turn the reading into an astrology report. The cards lead; the sky colours the timing and the tone.

Also honour what the specific spread is FOR:
- "fork": the whole point is the comparison. Explicitly weigh Option A against Option B and commit to which the cards favour — do not hedge with "both have merit".
- "celtic_cross": card 0 (The Heart) and card 1 (The Cross) are a crossing pair — read them against each other. Note any contradiction between The Outcome and Hopes and Fears.
- "relationship": say plainly whether You and Them are moving toward or away from each other.
- "timeline": this spread exists to answer WHEN, so lean hardest on the TIMING layer below — give a real sequence and a rough timescale anchored to today's date, never just "when the time is right".
- "single": with only one card, go deep on it rather than wide — the narrative should still be substantive.

LAYER 2C — timing: a MANDATORY, ALWAYS-PRESENT paragraph, 1-3 sentences, saying something concrete about WHEN. This is not optional and not something to fold into the narrative — it is its own field, and it is required content, not decoration, every single reading. You are given TODAY'S DATE, and most numbered Minor Arcana carry a "Timing window" (the Golden Dawn decan they rule — a ~10-day period of the year); zodiacal Majors carry their whole sign period. Use them like this:
- Convert a window into something human relative to today — "大約三週後", "這個月底前", "要等到入秋" — rather than quoting a raw date range at the seeker.
- These windows are indicative, not appointments. Say "前後", "大約", "這段期間附近" and never promise an exact day. If a window has already passed this year, read it as the coming year's return of that period, or as "this cycle has already begun".
- Weight it by position: a timing window on a "near future"/"outcome"/"when" position is meaningful; one sitting on "the past" or "your attitude" usually is not — prefer a card whose position actually concerns the future.
- Cards with no window (Aces, court cards, planetary Majors like The Tower or The Magician) simply carry no timing; do not invent one for them — pick a different card in the spread that does carry one instead.
- FALLBACK, so this field is never empty: if truly nothing in the spread carries a usable window, say plainly what the pacing feels like instead — fast-moving vs slow-burning, based on the suits present (Wands fastest, then Swords, then Cups, Pentacles slowest) — or fall back to the Moon phase's own tempo (waxing = building soon, waning = winding down first). Every reading must leave the seeker with SOME sense of pace or window; "無法判斷時間" is never an acceptable answer.

LAYER 3 — advice: EXACTLY 2-3 concrete, actionable suggestions rooted in what the cards actually revealed (not generic life advice), written as short flowing paragraphs separated by blank lines (no bullets), each opening with something like "Consider...", "This week, try...", "Notice when..." (in Chinese: 「考慮…」「這週試著…」「留意當你…」). Each suggestion must be specific enough that the seeker could act on it tomorrow. Aim for 120-200 characters in Chinese, or 60-110 words in English, across the whole advice section — one thin sentence is not enough.

LANGUAGE RULE — critical, applies to ALL layers including every single card_analyses entry: detect the language of the seeker's question and write EVERYTHING in that same language, with no exceptions and no layer left in a different language than the others. Traditional Chinese question → respond entirely in Traditional Chinese as used in Taiwan (繁體中文，台灣用語，例如「軟體」而非「软件」), never Simplified, never English. English question → English throughout. Card names are given as "English / 中文"; when writing in Chinese always use the Chinese name (寶劍六), never the English one, so the text matches the card labels the seeker sees on screen.

NO UNTRANSLATED ESOTERIC TERMS IN A CHINESE RESPONSE — this includes Hebrew letter names, Sephirah names, and planet-in-sign phrases (Aleph, Tiphareth, Chokmah, Malkuth, "Saturn in Pisces", etc.). If a Golden Dawn correspondence is worth citing at all, translate it fully into the plain-language gloss you were given and use ONLY that — never the proper noun itself, not even as a label in parentheses. 「傷口已形成具體後果（Malkuth 的落地結果）」is wrong twice over: the Hebrew name adds nothing a reader can use, and it should never have appeared as its own bracketed aside in the first place. Write instead as one plain clause inside the sentence, e.g. 「這道傷早已落成具體的現實,不再是還沒發生的事」— the reader should never see a word they'd have to look up.

Return ONLY valid JSON:
{ "card_analyses": [{ "index": 0, "interpretation": "..." }], "tldr": "...", "timing": "...", "narrative": "...", "advice": "..." }`;

// Elemental dignities + deck composition, computed deterministically rather than asked of the
// model — it reliably miscounts suits/majors and mis-derives dignities when left to do it itself.
// Dignities are the Golden Dawn's own rule set: same element strengthens; Fire&Air and Water&Earth
// are friendly; Fire&Water and Air&Earth are hostile; the remaining pairs are neutral. GD applies
// these to the Minor Arcana, so Majors are reported separately as trumps rather than forced into
// an element (their planetary attributions have no single agreed element).
const SUIT_ELEMENT = { wands: 'Fire', cups: 'Water', swords: 'Air', pentacles: 'Earth' };
const DIGNITY = {
  'Fire|Fire': 'same element — strongly reinforced',
  'Water|Water': 'same element — strongly reinforced',
  'Air|Air': 'same element — strongly reinforced',
  'Earth|Earth': 'same element — strongly reinforced',
  'Fire|Air': 'friendly (both active) — mutually strengthening',
  'Water|Earth': 'friendly (both passive) — mutually strengthening',
  'Fire|Water': 'hostile — they weaken each other',
  'Air|Earth': 'hostile — they weaken each other',
  'Fire|Earth': 'neutral — neither helps nor harms',
  'Air|Water': 'neutral — neither helps nor harms',
};
function dignityOf(a, b) {
  return DIGNITY[`${a}|${b}`] || DIGNITY[`${b}|${a}`] || null;
}

// Golden Dawn timing: every numbered Minor 2-10 rules one decan — a real ~10-day window of the
// tropical year — and each zodiacal Major rules a whole sign. Card n maps to decan (n-2)%3 of its
// sign, which is why e.g. Wands 2/3/4 are the three decans of Aries in order. Computing the actual
// dates lets a reading say "late March" instead of "when the time is right".
const SIGN_START = {
  Aries: [3, 21], Taurus: [4, 20], Gemini: [5, 21], Cancer: [6, 21],
  Leo: [7, 23], Virgo: [8, 23], Libra: [9, 23], Scorpio: [10, 23],
  Sagittarius: [11, 22], Capricorn: [12, 22], Aquarius: [1, 20], Pisces: [2, 19],
};
function fmtMD(month, day) { return `${month}/${day}`; }
function addDays(month, day, n) {
  const d = new Date(2001, month - 1, day + n);   // non-leap reference year
  return [d.getMonth() + 1, d.getDate()];
}
function timingWindow(card) {
  const astro = (card.goldenDawn || {}).astrological || '';
  const inSign = astro.match(/in (\w+)$/);
  if (inSign && typeof card.number === 'number' && card.number >= 2 && card.number <= 10) {
    const start = SIGN_START[inSign[1]];
    if (!start) return null;
    const idx = (card.number - 2) % 3;                       // which decan of that sign
    const [m1, d1] = addDays(start[0], start[1], idx * 10);
    const [m2, d2] = addDays(start[0], start[1], idx * 10 + 9);
    return `${fmtMD(m1, d1)}–${fmtMD(m2, d2)} (decan ${idx + 1} of ${inSign[1]})`;
  }
  if (SIGN_START[astro]) {                                   // zodiacal Major = the whole sign
    const start = SIGN_START[astro];
    const [m2, d2] = addDays(start[0], start[1], 29);
    return `${fmtMD(start[0], start[1])}–${fmtMD(m2, d2)} (${astro} period)`;
  }
  return null;   // Aces, courts, planetary/elemental Majors carry no date window
}

// ── Plain-language glosses for the esoteric vocabulary ──────────────────────
// Without these the model receives bare labels ("Sephirah: Chokmah") and has to recall what they
// mean, which produces confident-sounding filler and leaves the reader staring at a word that
// explains nothing. Supplying the meaning turns the correspondence layer from jargon into an
// actual second lens. Glosses are written in English because the prompt is; the model renders
// them in the seeker's language like everything else.
const SEPHIRAH_MEANING = {
  Kether: 'the seed-point: undivided potential before anything has taken shape',
  Chokmah: 'the first outward push: raw force and impulse, before it has direction',
  Binah: 'the shaping womb: gives form, limit and structure to raw force',
  Chesed: 'expansion: generosity, abundance, building outward without restraint',
  Geburah: 'severity: cutting back, discipline, the necessary destruction',
  Tiphareth: 'the balanced centre: harmony, the heart, where opposites integrate',
  Netzach: 'desire and endurance: instinct, feeling, what keeps pulling you',
  Hod: 'the ordering mind: intellect, analysis, language, making it legible',
  Yesod: 'the underlayer: dreams, imagination, the subconscious beneath appearances',
  Malkuth: 'the material world: manifestation, the body, the concrete result',
};
const LETTER_MEANING = {
  Aleph: 'ox / breath — the silent origin', Beth: 'house — the container',
  Gimel: 'camel — carrying across an emptiness', Daleth: 'door — the threshold',
  Heh: 'window — seeing through', Vav: 'nail — what joins things',
  Zayin: 'sword — discernment, cutting apart', Cheth: 'fence — enclosure and protection',
  Teth: 'serpent — hidden, coiled strength', Yod: 'hand — the smallest seed of action',
  Kaph: 'palm — grasping, the turning grip', Lamed: 'ox-goad — what drives and teaches',
  Mem: 'water — the depths', Nun: 'fish — movement within the deep',
  Samekh: 'prop — the support that holds you up', Ayin: 'eye — how you see, and what you do not',
  Peh: 'mouth — speech, the sudden utterance', Tzaddi: 'fishhook — drawing up from below',
  Qoph: 'back of the head — the unconscious, what is behind you',
  Resh: 'head / face — the one who looks out', Shin: 'tooth / fire — what consumes and transforms',
  Tav: 'mark / seal — completion, the finished imprint',
};
const PLANET_MEANING = {
  Mercury: 'thought, communication, quickness', Venus: 'value, attraction, what you want',
  Mars: 'drive, conflict, the will to act', Jupiter: 'expansion, opportunity, largeness',
  Saturn: 'limit, time, discipline, the weight of consequence',
  Sun: 'core self, vitality, what you shine at', Moon: 'feeling, instinct, the tidal inner life',
};
const SIGN_MEANING = {
  Aries: 'the urge to begin, raw initiative', Taurus: 'steadiness, the senses, holding ground',
  Gemini: 'exchange, curiosity, scattered attention', Cancer: 'feeling, belonging, protection',
  Leo: 'self-expression, visibility, pride', Virgo: 'refinement, usefulness, correcting the details',
  Libra: 'weighing, fairness, the pull of relationship', Scorpio: 'depth, intensity, transformation',
  Sagittarius: 'reaching outward, meaning, the wider view', Capricorn: 'structure, ambition, the long climb',
  Aquarius: 'detachment, reform, the view from outside', Pisces: 'dissolving, imagination, merging',
};
// Turn a raw correspondence into "label (what it actually means)".
function explainGD(gd) {
  const out = [];
  if (gd.gdTitle) out.push(`Title: "${gd.gdTitle}"`);
  if (gd.hebrewLetter) {
    const key = (gd.hebrewLetter.match(/^(\w+)/) || [])[1];
    const m = LETTER_MEANING[key];
    out.push(`Hebrew letter: ${gd.hebrewLetter}${m ? ` — ${m}` : ''}`);
  }
  if (gd.treePath) {
    out.push(`Tree of Life: ${gd.treePath}, running between ${gd.pathConnects || '?'}`);
    (gd.pathConnects || '').split(/[–-]/).forEach(s => {
      const n = s.trim(); if (SEPHIRAH_MEANING[n]) out.push(`  · ${n} = ${SEPHIRAH_MEANING[n]}`);
    });
  }
  if (gd.sephirah) {
    const m = SEPHIRAH_MEANING[gd.sephirah];
    out.push(`Sephirah: ${gd.sephirah}${m ? ` = ${m}` : ''}`);
  }
  if (gd.elementalFormula) out.push(`Elemental formula: ${gd.elementalFormula} (the first element is the active drive, the second is the medium it works through)`);
  if (gd.astrological) {
    const pin = gd.astrological.match(/^(\w+) in (\w+)$/);
    if (pin) {
      const [, p, s] = pin;
      out.push(`Decan: ${gd.astrological} — ${p} (${PLANET_MEANING[p] || '?'}) acting through ${s} (${SIGN_MEANING[s] || '?'})`);
    } else {
      const ELEMENT_MEANING = {
        Fire: 'drive, spirit, the will that burns forward', Water: 'feeling, memory, what flows and dissolves',
        Air: 'mind, breath, thought and the space between things', Earth: 'body, matter, what can actually be held',
      };
      // strip the wrappers the data uses: "The Moon", "Pure Fire", "Fire (element) / Spirit"
      const bare = gd.astrological
        .replace(/\s*\(element\).*$/, '').split('/')[0]
        .replace(/^(The|Pure)\s+/i, '').trim();
      const m = PLANET_MEANING[bare] || SIGN_MEANING[bare] || ELEMENT_MEANING[bare];
      out.push(`Astrological: ${gd.astrological}${m ? ` — ${m}` : ''}`);
    }
  }
  return out;
}

// ── Live sky ────────────────────────────────────────────────────────────────
// The Golden Dawn attributions the deck already carries ARE astrological, so the real sky and
// the cards speak one language: the Sun sitting in a given decan is sitting on a specific card.
// Meeus low-precision formulae, no dependency and no API key. Validated against known events:
// the 2000-01-06 18:14 UTC new moon comes out at 0.00° elongation, and the 2026 equinox and
// solstice both land on 0.0° of the expected sign.
const ZODIAC = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
const nrm = x => ((x % 360) + 360) % 360;
const toJD = date => date.getTime() / 86400000 + 2440587.5;

function sunLongitude(jd) {
  const n = jd - 2451545.0;
  const L = nrm(280.460 + 0.9856474 * n);
  const g = nrm(357.528 + 0.9856003 * n) * Math.PI / 180;
  return nrm(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
}
function moonLongitude(jd) {
  const T = jd - 2451545.0, R = Math.PI / 180;
  const Lp = nrm(218.3164477 + 13.17639648 * T);
  const M  = nrm(357.5291092 + 0.98560028 * T) * R;
  const Mp = nrm(134.9633964 + 13.06499295 * T) * R;
  const F  = nrm(93.2720950 + 13.22935024 * T) * R;
  const Dd = nrm(297.8501921 + 12.19074912 * T) * R;
  return nrm(Lp
    + 6.288774 * Math.sin(Mp)      + 1.274027 * Math.sin(2 * Dd - Mp)
    + 0.658314 * Math.sin(2 * Dd)  + 0.213618 * Math.sin(2 * Mp)
    - 0.185116 * Math.sin(M)       - 0.114332 * Math.sin(2 * F)
    + 0.058793 * Math.sin(2 * Dd - 2 * Mp) + 0.057066 * Math.sin(2 * Dd - M - Mp)
    + 0.053322 * Math.sin(2 * Dd + Mp)     + 0.045758 * Math.sin(2 * Dd - M));
}
function zodiacPos(lon) {
  const i = Math.floor(nrm(lon) / 30);
  const deg = nrm(lon) - i * 30;
  return { sign: ZODIAC[i], degree: deg, decan: Math.floor(deg / 10) + 1 };
}
const MOON_PHASES = ['新月','眉月','上弦月','盈凸月','滿月','虧凸月','下弦月','殘月'];
function skyNow(when) {
  const jd = toJD(when || new Date());
  const sl = sunLongitude(jd), ml = moonLongitude(jd);
  const elong = nrm(ml - sl);
  return {
    sun: zodiacPos(sl),
    moon: zodiacPos(ml),
    phaseName: MOON_PHASES[Math.floor(nrm(elong + 22.5) / 45) % 8],
    illumination: Math.round((1 - Math.cos(elong * Math.PI / 180)) / 2 * 100),
    waxing: elong < 180,   // Moon pulling away from the Sun = building toward full
  };
}
// Which decan a numbered Minor rules — same mapping timingWindow() uses, reused for resonance.
function cardDecan(card) {
  const m = ((card.goldenDawn || {}).astrological || '').match(/in (\w+)$/);
  if (!m || typeof card.number !== 'number' || card.number < 2 || card.number > 10) return null;
  return { sign: m[1], decan: ((card.number - 2) % 3) + 1 };
}

// When the Sun entered the decan it currently occupies, and when it leaves. Derived by stepping
// the real solar position rather than from the fixed sign-start table timingWindow() uses — the
// Sun runs slower near aphelion, so the table drifts a day or two from the actual boundary and
// would contradict the degrees shown right next to it in the panel.
function currentDecanSpan(now) {
  const DAY = 86400000;
  const idx = t => Math.floor(sunLongitude(toJD(t)) / 10);
  const cur = idx(now);
  let start = now, end = now;
  for (let i = 1; i <= 20; i++) {
    const t = new Date(now.getTime() - i * DAY);
    if (idx(t) !== cur) break;
    start = t;
  }
  for (let i = 1; i <= 20; i++) {
    const t = new Date(now.getTime() + i * DAY);
    if (idx(t) !== cur) break;
    end = t;
  }
  const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
  return { from: md(start), to: md(end), daysLeft: Math.round((end - now) / DAY) };
}

// The deck lives next to the code and never changes at runtime — read it once, lazily, so the
// sky endpoint can name the card the Sun is currently sitting on. (Readings don't need this:
// the client already sends the drawn cards in the request body.)
let _deck = null, _deckIndex = null;
function loadDeck() {
  if (!_deck) _deck = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'tarot-cards.json'), 'utf8'));
  return _deck;
}
// Authoritative RWS imagery for a card id, independent of what the client sent.
function deckById(id) {
  if (!_deckIndex) {
    _deckIndex = {};
    loadDeck().forEach(c => { if (c.rws) _deckIndex[c.id] = c.rws; });
  }
  return _deckIndex[id];
}

function skyContext(cards, positions) {
  const sky = skyNow();
  const lines = [
    `Sun: ${sky.sun.degree.toFixed(1)}° ${sky.sun.sign} (decan ${sky.sun.decan})`,
    `Moon: ${sky.moon.degree.toFixed(1)}° ${sky.moon.sign} (decan ${sky.moon.decan})`,
    `Moon phase: ${sky.phaseName}, ${sky.illumination}% lit, ${sky.waxing ? 'WAXING — building toward full' : 'WANING — releasing toward dark'}`,
  ];
  // Resonance: a drawn card ruling the very decan the Sun or Moon occupies right now. Uncommon,
  // and worth naming when it happens — the sky is sitting on a card the seeker just drew.
  const hits = [];
  cards.forEach((c, i) => {
    const d = cardDecan(c);
    if (!d) return;
    const where = (positions[i] || {}).name || `card ${i}`;
    if (d.sign === sky.sun.sign && d.decan === sky.sun.decan) {
      hits.push(`${c.nameZh || c.name} (in "${where}") rules the exact decan the SUN occupies right now`);
    }
    if (d.sign === sky.moon.sign && d.decan === sky.moon.decan) {
      hits.push(`${c.nameZh || c.name} (in "${where}") rules the exact decan the MOON occupies right now`);
    }
  });
  if (hits.length) lines.push(`RESONANCE — ${hits.join('; ')}`);
  return `\n\nSKY RIGHT NOW (computed, factual):\n${lines.map(l => `• ${l}`).join('\n')}`;
}

function spreadDynamics(cards, positions) {
  const total = cards.length;
  if (total < 2) return '';   // dignities and ratios are meaningless on a single card
  const lines = [];

  const majors = cards.filter(c => c.arcanaType === 'major');
  const courtRanks = new Set(['Page', 'Knight', 'Queen', 'King']);
  const courts = cards.filter(c => courtRanks.has(c.number));
  const reversed = cards.filter(c => c.isReversed);

  const pct = Math.round((majors.length / total) * 100);
  lines.push(`Major Arcana: ${majors.length}/${total} (${pct}%)${pct >= 50 ? ' — unusually high; forces larger than the seeker\'s day-to-day choices dominate this reading' : ''}`);

  const suitCounts = {};
  cards.filter(c => c.suit).forEach(c => { suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1; });
  const suitStr = Object.entries(suitCounts).map(([s, n]) => `${s} (${SUIT_ELEMENT[s]}) ×${n}`).join(', ');
  if (suitStr) lines.push(`Suits present: ${suitStr}`);
  const dominant = Object.entries(suitCounts).find(([, n]) => n >= Math.max(2, Math.ceil(total / 2)));
  if (dominant) lines.push(`Dominant suit: ${dominant[0]} — the question is playing out mainly in the realm of ${SUIT_ELEMENT[dominant[0]]}`);

  if (courts.length) lines.push(`Court cards: ${courts.length} — other people or adopted personas are active in this situation`);
  if (reversed.length) lines.push(`Reversed: ${reversed.length}/${total} — that proportion of the energy is turned inward, delayed, or blocked`);

  // repeated numbers carry numerological emphasis in traditional practice
  const numCounts = {};
  cards.filter(c => typeof c.number === 'number' && c.arcanaType === 'minor')
    .forEach(c => { numCounts[c.number] = (numCounts[c.number] || 0) + 1; });
  const repeats = Object.entries(numCounts).filter(([, n]) => n >= 2);
  if (repeats.length) lines.push(`Repeated numbers: ${repeats.map(([n, c]) => `${c}× the number ${n}`).join(', ')} — that stage of the cycle is emphasised`);

  // Adjacent-pair elemental dignities (minors only, per GD practice). Neutral pairs are
  // dropped entirely — a "no relationship" fact was still getting forced into the narrative as
  // a strained metaphor ("水與劍並不互相打架，表示你的感受和判斷沒有矛盾"), which explains nothing.
  // Only same-element (reinforcing) or friendly/hostile pairs carry real signal worth writing about.
  const dignities = [];
  for (let i = 0; i < cards.length - 1; i++) {
    const a = cards[i], b = cards[i + 1];
    const ea = SUIT_ELEMENT[a.suit], eb = SUIT_ELEMENT[b.suit];
    if (!ea || !eb) continue;
    const rel = dignityOf(ea, eb);
    if (rel && !rel.startsWith('neutral')) {
      const pa = (positions[i] || {}).name || `card ${i}`;
      const pb = (positions[i + 1] || {}).name || `card ${i + 1}`;
      dignities.push(`${pa} (${ea}) + ${pb} (${eb}): ${rel}`);
    }
  }
  if (dignities.length) lines.push(`Elemental dignities between adjacent cards (only non-neutral pairs are listed; say nothing about pairs not listed here):\n  - ${dignities.join('\n  - ')}`);

  return lines.length ? `\n\nSPREAD DYNAMICS (computed, factual — use these, do not recount them yourself):\n${lines.map(l => `• ${l}`).join('\n')}` : '';
}

// Shared helper for one-shot OpenAI calls. Pass jsonMode:true to force a raw-JSON response (used by the
// structured-output callers). Pass modelOverride to use something other than the default.
function callOpenAI(system, userText, maxTokens, jsonMode, modelOverride) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Promise.reject(new Error('OPENAI_API_KEY not set'));
  const model = modelOverride || process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const payload = JSON.stringify({
    model,
    max_completion_tokens: maxTokens,  // newer models (gpt-5.x) reject the legacy max_tokens param
    // gpt-5.x is reasoning-capable and can burn the entire token budget on hidden
    // reasoning before writing anything, leaving content empty (finish_reason: "length",
    // reasoning_tokens == maxTokens) — seen in practice on /api/news category summaries
    // with larger inputs. None of these tasks need deep multi-step reasoning, so keep it low.
    reasoning_effort: 'low',
    messages: [{ role: 'system', content: system }, { role: 'user', content: userText }],
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  });
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(payload) },
    }, resp => { const chunks = []; resp.on('data', c => chunks.push(c)); resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
    r.on('error', reject); r.write(payload); r.end();
  }).then(raw => {
    const msg = JSON.parse(raw);
    if (msg.error) throw new Error(msg.error.message || 'OpenAI API error');
    return (msg.choices?.[0]?.message?.content || '').trim();
  });
}

// Shared helper for one-shot Claude (Anthropic) calls — same signature as callOpenAI so call
// sites can swap between the two freely. jsonMode has no native API param on Anthropic's Messages
// endpoint (unlike OpenAI's response_format); the tarot prompts already say "Return ONLY valid
// JSON", so this just strips a ```json fence defensively in case the model wraps it anyway.
function callClaude(system, userText, maxTokens, jsonMode, modelOverride, _isRetry) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Promise.reject(new Error('ANTHROPIC_API_KEY not set'));
  const model = modelOverride || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const payload = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userText }],
  });
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, resp => { const chunks = []; resp.on('data', c => chunks.push(c)); resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); });
    r.on('error', reject); r.write(payload); r.end();
  }).then(raw => {
    const msg = JSON.parse(raw);
    if (msg.error) throw new Error(msg.error.message || 'Claude API error');
    let text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (jsonMode) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    return text;
  }).catch(err => {
    // Cloud Run cold starts occasionally flake on the container's first outbound HTTPS
    // connection (DNS/TLS not warm yet) — one quiet retry absorbs that instead of falling
    // through to the generic English fallback on what would otherwise be a fine request.
    // Only retries genuine network-level failures, not a clean {error:...} API response
    // (a bad key or quota error won't be fixed by trying again).
    if (_isRetry) throw err;
    const isNetworkError = !!err.code || /ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(err.message || '');
    if (!isNetworkError) throw err;
    return new Promise(res => setTimeout(res, 800)).then(() => callClaude(system, userText, maxTokens, jsonMode, modelOverride, true));
  });
}


const PORT     = process.env.PORT || 8765;  // Cloud Run injects PORT
const BASE_DIR = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.md':   'text/plain; charset=utf-8',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}


const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ── API: POST /api/tarot/select-spread ────────────
  // ── API: GET /api/tarot/sky ───────────────────────
  // Current sky plus the card the Sun is literally sitting on — in the Golden Dawn scheme every
  // numbered Minor rules one decan, so at any moment exactly one card is "lit" by the Sun.
  if (req.method === 'GET' && url.pathname === '/api/tarot/sky') {
    try {
      const sky = skyNow();
      const deck = loadDeck();
      const ruler = (sign, decan) => {
        const c = deck.find(x => { const d = cardDecan(x); return d && d.sign === sign && d.decan === decan; });
        return c ? { name: c.name, nameZh: c.nameZh, image: c.image, gdTitle: (c.goldenDawn || {}).gdTitle || '' } : null;
      };
      json(res, {
        sun: sky.sun, moon: sky.moon,
        phaseName: sky.phaseName, illumination: sky.illumination, waxing: sky.waxing,
        sunCard: ruler(sky.sun.sign, sky.sun.decan),
        moonCard: ruler(sky.moon.sign, sky.moon.decan),
        sunSpan: currentDecanSpan(new Date()),
      });
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tarot/select-spread') {
    const FALLBACK = { spread_type: 'three_card', card_count: 3, positions: [
      { name: 'Past', meaning: 'The energy or event that led to this moment.' },
      { name: 'Present', meaning: 'The current energy and what is active right now.' },
      { name: 'Future', meaning: 'The likely direction if current energy continues.' },
    ], reasoning: 'Defaulting to a classic three-card spread.' };
    try {
      const body = JSON.parse(await readBody(req));
      const question = (body.question || '').trim();
      if (!question) { json(res, { error: 'question required' }, 422); return; }
      const text = await callOpenAI(TAROT_SPREAD_PROMPT, `Question: "${question}"`, 600, true);
      const data = JSON.parse(text);
      json(res, { spread_type: data.spread_type, card_count: data.card_count, positions: data.positions || [], reasoning: data.reasoning || '' });
    } catch (e) { json(res, FALLBACK); }
    return;
  }

  // ── API: POST /api/tarot/reading ──────────────────
  if (req.method === 'POST' && url.pathname === '/api/tarot/reading') {
    try {
      const body = JSON.parse(await readBody(req));
      const question = (body.question || '').trim();
      const positions = body.positions || [];
      const drawnCards = body.drawn_cards || [];
      if (!question || !drawnCards.length) { json(res, { error: 'question and drawn_cards required' }, 422); return; }
      if (drawnCards.length !== positions.length) { json(res, { error: 'drawn_cards and positions length mismatch' }, 422); return; }
      const cardsBlock = drawnCards.map((c, i) => {
        const pos = positions[i] || {};
        const kw = c.isReversed ? (c.reversedKeywords || []) : (c.uprightKeywords || []);
        const meaning = c.isReversed ? c.reversedMeaning : c.shortMeaning;
        // Golden Dawn attributions come straight from tarot-cards.json so the model cites the
        // real correspondence for each card instead of recalling one from memory (which it
        // gets wrong often enough to matter — e.g. Strength/Justice numbering, decan rulers).
        const gd = c.goldenDawn || {};
        const gdParts = explainGD(gd);
        const gdLine = gdParts.length ? `\nGolden Dawn correspondence:\n  ${gdParts.join('\n  ')}` : '';
        // send the Chinese name too, so a Chinese reading can name cards the same way the UI
        // labels them (the UI shows 寶劍六; without this the model writes "Six of Swords")
        const nameLine = c.nameZh ? `${c.name} / ${c.nameZh}` : c.name;
        // The RWS picture, supplied as data so the imagery in a reading is the deck's actual
        // imagery rather than whatever the model half-remembers about a famous card. Looked up
        // server-side by id instead of trusting the copy the client posted: a browser holding a
        // cached older tarot-cards.json would otherwise send cards with no imagery at all, and
        // the prompt's "use only the supplied description" rule would then starve the layer.
        const rws = deckById(c.id) || c.rws || {};
        const rwsLine = rws.scene
          ? `\nThe picture: ${rws.scene}\nSymbols: ${(rws.symbols || []).join(' | ')}`
          : '';
        const tw = timingWindow(c);
        const twLine = tw ? `\nTiming window (approximate): ${tw}` : '';
        return `Card ${i}: ${nameLine}${c.isReversed ? ' (Reversed)' : ''}\nPosition: ${pos.name} — ${pos.meaning}\nKeywords: ${(kw || []).join(', ')}\nMeaning: ${meaning || ''}${rwsLine}${gdLine}${twLine}`;
      }).join('\n\n');
      // the model has no idea what day it is; without this it cannot turn a decan window into
      // "about three weeks from now", which is the whole point of the timing layer
      const today = new Date();
      const todayLine = `TODAY'S DATE: ${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const userMsg = `${todayLine}\nSEEKER'S QUESTION: ${question}\nSPREAD TYPE: ${body.spread_type || ''}\n\n${cardsBlock}${spreadDynamics(drawnCards, positions)}${skyContext(drawnCards, positions)}`;
      // 4500 not 3000: the Golden Dawn layer adds a second passage per card, and a 10-card
      // Celtic Cross in Chinese was the case that would truncate first.
      // gpt-5.4 (not the app-wide gpt-5.4-mini default): benchmarked head-to-head on a 10-card
      // Celtic Cross, the full model produced a ~42% richer Golden Dawn layer and ~39% longer
      // advice for ~19s more latency — worth it here, where the user is already watching a
      // "reading your cards" animation and quality matters more than speed.
      const text = await callOpenAI(TAROT_READING_PROMPT, userMsg, 4500, true, 'gpt-5.4');
      const data = JSON.parse(text);
      json(res, data);
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }

  // ── Static files (whitelist) ──────────────────────
  // Only the assets the app needs are servable — server.js, package.json, .env etc. are not.
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const allowed = rel === 'index.html' || rel === 'support.js' || rel === 'tarot-cards.json'
    || (rel.startsWith('tarot-cards/') && rel.endsWith('.jpg'));
  const filePath = path.resolve(BASE_DIR, rel);
  if (!allowed || !filePath.startsWith(BASE_DIR + path.sep) || !fs.existsSync(filePath)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  // card images never change; everything else revalidates so a stale tab can't run old JS
  const cacheControl = rel.startsWith('tarot-cards/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain', 'Cache-Control': cacheControl });
  res.end(fs.readFileSync(filePath));
});

server.listen(PORT, () => console.log(`🔮 Tarot Reader → http://localhost:${PORT}`));
