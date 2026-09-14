# 0007. Record on the phone's own microphone, not the AirPods, and say so in the app

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** session zephyr, from a measured day of transcripts
- **Tenet invoked:** an empty deck is honest, an invented card is not. A transcript he cannot trust is an invented card.

## Context

On 2026-09-13 David read ten notes into the UPDATES lane and the transcripts
came back visibly degraded. The misses were not random, they were consonant
losses in exactly the words that carry the meaning:

| he said | it stored |
|---|---|
| "<a research method>" | "the age by track dog" |
| "a building name" | "Bitsy", then "Bechdel" |
| "a club acronym" | "signed muscle yarns" |
| "a campus event" | "the top of IR" |

His own question: *"check audio quality, it should have been from airpods and
on an apple phone so should have really good quality right??"*

Reasonable, and backwards. AirPods are an excellent output device and a poor
input device, and the cause is Bluetooth rather than Apple. Playback runs over
A2DP, which is one-way and buffered and can afford a high bitrate. The moment
any app opens the microphone the link must become two-way and low-latency, so
iOS switches the earbuds to the voice path, which is built for phone calls:
mono, heavily processed, 16 kHz or below, against 48 kHz for the iPhone's own
mic array.

**This is the same finding voicetype reached on Windows six days earlier**
(2026-09-07, session dresden, Crystal `System/Voice-Typing`): *"Windows can only
reach AirPods over HFP, the compressed telephone path... that is the whole 3.8%
vs 10-14% WER gap."* Two operating systems, one cause, found twice because the
first finding lived in a note about a different program.

A second, independent degradation was in our own code: `getUserMedia({audio:
true})` takes the platform default, which enables echo cancellation, which
routes capture through the telephony DSP that downsamples and gates. Correct
for a call, wrong for dictation, where the product IS the consonants.

## Options considered

1. **Say nothing and let him work it out.** Free. But the symptom is a bad
   transcript three weeks later, with no way to tell a bad mic from a bad model
   from a noisy room, which is precisely the state that produced this decision.
2. **Refuse to record over Bluetooth.** Honest and unusable. He records while
   walking; a recorder that refuses is a recorder he stops opening, and the
   whole app depends on the write being one tap.
3. **Switch the input automatically to the built-in mic.** Not possible from a
   browser. A web app cannot choose the physical route iOS gives it, and the
   device list does not distinguish them reliably.
4. **Fix the constraints, then MEASURE and REPORT the capture.** Ask for the
   high-quality path, then read back what was actually granted, show it while
   recording, and store it with the note.

## Decision

Option 4, plus the constraint fix.

- `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: true`,
  mono. Gain control stays on deliberately: he records at arm's length in rooms
  of wildly different loudness, and a drifting level is worse than a nudged one.
- Every recording carries `mic`, `hz`, `micLevel` and `mime` to the Worker, and
  the Worker keeps them on the note.
- While recording, the app names the microphone and the rate. When the capture
  is the Bluetooth voice path it says so, and says the actionable half: take
  them out.
- On the Notes tab the warning sits **on the note whose text is bad**, not in a
  settings screen he will never open.
- `language: "en"` is pinned on the Groq call. An unpinned model spends capacity
  deciding what language a degraded clip is, and the 2026-09-13 note that came
  back as an Australian promo URL is the signature of it deciding wrong.

## Consequences

**Easier:** a bad transcript is now a lookup rather than an argument. The note
says what recorded it.

**Worse, and it is a real cost:** he now gets told, on screen, that the thing he
is comfortable using is the wrong tool, every time he uses it. That is a nag,
and nags get ignored. The warning is therefore written once per recording and
once per affected note, never as a modal and never as a blocker, and it is
phrased as an instruction rather than a diagnosis.

**Also worse:** disabling noise suppression will make a genuinely loud room
sound worse than it used to, because the DSP was doing something. The bet is
that whisper handles broadband noise better than it handles a gated,
downsampled voice channel. **This is a bet, not a measurement**, and it is the
one claim here that has not been verified on his device.

**Ruled out:** any future "why is transcription bad" investigation that does not
start by reading `mic` and `hz` off the note.
