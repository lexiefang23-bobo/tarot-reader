# Tarot Reader

An LLM-powered tarot reading web app. You ask a question, the app picks a spread for it, you cut the deck and draw cards, and the model writes a reading grounded in real card data — not whatever it half-remembers about tarot.

Zero-dependency Node.js server (`server.js`) + a single-page frontend (`index.html`), deployable to Google Cloud Run as-is.

## LLM architecture

```
question ──► [Stage 1] spread selection ──► user cuts deck & draws cards
                  (JSON mode)                         │
                                                      ▼
            deterministic pre-computation (in code, not by the model)
            · Major Arcana ratio, suit/element balance, court cards, reversals
            · elemental dignities between adjacent cards (Golden Dawn rules)
            · Golden Dawn decan → calendar timing window per card
            · live sky: Sun/Moon position, moon phase, card-to-sky resonance
                                                      │
            grounding from tarot-cards.json (78 cards)│
            · keywords & meanings · Rider-Waite-Smith scene + symbols
            · Golden Dawn correspondences (Hebrew letter, Tree of Life path, decan)
                                                      ▼
                         [Stage 2] one structured-JSON call, four roles:
                         card analyst · Golden Dawn scholar · synthesizer · advisor
                                                      ▼
                  { card_analyses[], tldr, timing, narrative, advice }
```

Design decisions:

- **Compute facts in code, let the model interpret.** Models reliably miscount suits and mis-derive elemental dignities, so those are computed server-side and passed in as "computed, factual — do not recount".
- **Ground every card in data.** RWS imagery and Golden Dawn attributions come from `tarot-cards.json`, looked up server-side by card id, so the reading cites the deck's actual symbolism and correct correspondences.
- **One combined call instead of a sequential agent chain.** The original pipeline ran three sequential agents (analyst → synthesizer → advisor); merging them into one JSON response removed two round-trips and kept every layer.
- **Graceful fallback.** If spread selection fails, the app falls back to a classic three-card spread instead of breaking the flow.
- **Provider-agnostic.** `callOpenAI` and `callClaude` share one signature (JSON mode, model override, network-error retry), so a call site can switch providers in one line. The reading uses a larger model than spread selection, a choice made after a head-to-head comparison on a 10-card Celtic Cross.

## Run locally

```bash
cp .env.example .env   # add your OPENAI_API_KEY
npm start              # http://localhost:8765
```

## Deploy (Cloud Run)

```bash
gcloud run deploy tarot-reader --source . --region asia-east1 \
  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest
```

## Notes

- Card images are the 1909 Rider-Waite-Smith deck (Pamela Colman Smith), public domain.
- `support.js` is a small bundled runtime that renders the `<x-dc>` template in `index.html` with React (loaded from a CDN).
