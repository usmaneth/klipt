# Chatterbox-Turbo ONNX Voice Clone Architecture

## Model I/O (verified from actual ONNX files)

### speech_encoder_q4f16.onnx
- IN: `audio_values` [1, N] float32 (24kHz mono audio samples)
- OUT: `audio_features` [1, M, 1024] float32
- OUT: `audio_tokens` [1, K] int64
- OUT: `speaker_embeddings` [1, 192] float32
- OUT: `speaker_features` [1, L, 80] float32

### embed_tokens_q4f16.onnx
- IN: `input_ids` [1, N] int64 — **SPEECH token IDs only (range 0-6562)**
- OUT: `inputs_embeds` [1, N, hidden_dim] float32
- **NOTE: This is speech_emb NOT text_emb. Vocab size = 6563 = audio codec tokens.**

### language_model_q4f16.onnx
- IN: `inputs_embeds` [1, N, hidden] float32
- IN: `attention_mask` [1, N] int64
- IN: `position_ids` [1, N] int64
- IN: `past_key_values.{0-23}.key` [1, 16, M, 64] float16
- IN: `past_key_values.{0-23}.value` [1, 16, M, 64] float16
- OUT: `logits` [1, N, 6563] float32 — outputs speech token probabilities
- OUT: `present.{0-23}.key/value` float16

### conditional_decoder_q4f16.onnx
- IN: `speech_tokens` [1, N] int64
- IN: `speaker_embeddings` [1, 192] float32
- IN: `speaker_features` [1, L, 80] float32
- OUT: `waveform` [1, samples] float32

## Correct Pipeline

The ONNX Turbo export is a **speech-to-speech** model, NOT text-to-speech:

1. **Speech Encoder**: Feed reference audio (your voice, 5-10s) → get audio_features, audio_tokens, speaker info
2. **Embed audio_features**: Use audio_features as the conditioning context for the LM (NOT text tokens)
3. **Language Model**: Autoregressively generate speech tokens (IDs 0-6562). Start with audio_features as context.
4. **Conditional Decoder**: Convert generated speech tokens → waveform using speaker embeddings

## What This Means

- **Text is NOT tokenized** — there's no text embedding in this ONNX export
- The model clones the STYLE of the reference audio and generates new speech tokens
- To do text-to-speech with voice cloning, we need a SEPARATE text-to-speech step:
  1. Generate speech audio from translated text (using any TTS: edge-tts, macOS say, etc.)
  2. Feed that TTS audio as the "reference" to the speech encoder
  3. Also feed the ORIGINAL voice as speaker reference
  4. The model converts the TTS audio to sound like the original speaker

## Alternative Approach

Use the full Chatterbox Python pipeline (which HAS text_emb) via a subprocess,
or find/request the text_emb ONNX export from Resemble AI.

## Constants
- SAMPLE_RATE: 24000
- START_SPEECH_TOKEN: 6561
- STOP_SPEECH_TOKEN: 6562
- SILENCE_TOKEN: 4299
- NUM_KV_LAYERS: 24
- NUM_KV_HEADS: 16
- HEAD_DIM: 64
