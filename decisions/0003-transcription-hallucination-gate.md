# 0003. Gate transcription on avg_logprob and words-per-second, not no_speech_prob

- **Status:** accepted
- **Date:** 2026-08-25
- **Deciders:** session guesthouse, measured
- **Tenet invoked:** an empty deck is honest, an invented card is not

## Context

The nightly read-aloud is transcribed by Groq's `whisper-large-v3-turbo`. The
obvious gate for "was there any speech" is the model's own `no_speech_prob`.

Measured against **three seconds of pure digital silence**:

- `no_speech_prob` returned **0.0000**. It is worthless here.
- The model returned `" www.patreon.com"` on one run and `"Thank you"` on
  another. These are YouTube-caption training data leaking through.

What actually separates speech from silence, measured on the same clips:

| signal | real speech | silence |
|---|---|---|
| `avg_logprob` | -0.36 | -0.81 |
| words per second | 2 to 3 | 0.33 |

A false positive here is not cosmetic: junk gets stored as a night's lecture
notes and then generates study cards.

## Options considered

- **`no_speech_prob` threshold.** One field, standard practice. Measured at
  0.0000 on pure silence, so it does not work.
- **Client-side VAD before upload.** More code, more battery, and it would not
  catch the prompt-echo failure at all.
- **A composite gate on measured signals.**

## Decision

Four checks: a junk-phrase denylist, words-per-second below 0.5, `avg_logprob`
below -0.7 on a short transcript, and a **vocabulary-echo check**, because given
non-speech the model sometimes hands the `VOCAB` prompt straight back.

## Consequences

Silence and noise are rejected reliably, and the vocabulary prompt keeps working
for real speech: a test recording returned "Nolte", "Lagrangian" and "MFET"
spelled correctly.

**What gets worse:** four thresholds tuned against one afternoon's measurements,
on one microphone, in one room. They may not hold on a different device, and
nothing re-measures them. A very short genuine recording could be rejected.

**Do not simplify this to `no_speech_prob`.** It was tested and it does not work.
