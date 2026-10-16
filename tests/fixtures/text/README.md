# Text & Prompt Fixtures

Deterministic text datasets and prompt suites for testing LLM text completion, tokenization, context windows, multilingual capabilities, structured schema generation, and security boundaries.

## Fixture Catalog

| File | Category | Format | Primary Testing Purpose |
|---|---|---|---|
| `prompts_short.json` | Short Prompts | JSON | Fast unit tests, single-shot completions, interactive latency verification |
| `prompts_multilingual.json` | Multilingual Suite | JSON | Spanish (sports/athletes), French, and German prompt comprehension and tokenization |
| `prompts_code_and_json.json` | Structured / Code | JSON | JSON schema enforcement, entity extraction, TypeScript route code generation |
| `prompts_adversarial.json` | Security / Adversarial | JSON | Prompt injection detection, cross-tenant impersonation defense, system prompt guardrails |
| `prompts_text_to_image.json` | Text-to-Image (DiT) | JSON | Latent patch diffusion workloads (`FLUX.1-schnell`, `stable-diffusion-3.5-medium`) |
| `prompts_media_inference.json` | Media Inference (Photo/Video) | JSON | Vision Transformer (`Qwen2.5-VL`, `CLIP-ViT`) and Video DiT (`Wan2.1`, `CogVideoX`) workloads paired with `tests/fixtures/media/` |
| `document_long_context.txt` | Long Context | Text | Context window testing, document summarization, multi-paragraph retrieval |


