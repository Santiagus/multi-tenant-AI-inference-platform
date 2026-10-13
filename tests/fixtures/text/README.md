# Text & Prompt Fixtures

Deterministic text datasets and prompt suites for testing LLM text completion, tokenization, context windows, multilingual capabilities, structured schema generation, and security boundaries.

## Fixture Catalog

| File | Category | Format | Primary Testing Purpose |
|---|---|---|---|
| `prompts_short.json` | Short Prompts | JSON | Fast unit tests, single-shot completions, interactive latency verification |
| `prompts_multilingual.json` | Multilingual Suite | JSON | Spanish (sports/athletes), French, and German prompt comprehension and tokenization |
| `prompts_code_and_json.json` | Structured / Code | JSON | JSON schema enforcement, entity extraction, TypeScript route code generation |
| `prompts_adversarial.json` | Security / Adversarial | JSON | Prompt injection detection, cross-tenant impersonation defense, system prompt guardrails |
| `document_long_context.txt` | Long Context | Text | Context window testing, document summarization, multi-paragraph retrieval |

