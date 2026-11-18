# UI jobs local harness — 2026-11-18T20-37-49Z

- Tenant: **`tenant-default`** (open Jobs UI filtered to this tenant)
- Provider: local_pytorch / local/gpu
- Succeeded: **11/12**

| Job | Model | Status | load_ms | inference_ms | in/out | accounting |
|---|---|---|---:|---:|---|---|
| `fdaa23ce` | mistralai/Mistral-7B-Instruct-v0.2 | SUCCEEDED | 21244.359 | 9482.154 | 10/245 | tokenizer |
| `23877070` | mistralai/Mistral-7B-Instruct-v0.2 | SUCCEEDED | 0 | 4701.169 | 10/159 | tokenizer |
| `5d0e7fb8` | deepseek-ai/DeepSeek-R1-Distill-Qwen-7B | SUCCEEDED | 39707.582 | 11242.626 | 5/384 | tokenizer |
| `e5f0ba42` | deepseek-ai/DeepSeek-R1-Distill-Qwen-7B | SUCCEEDED | 0 | 10974.684 | 5/384 | tokenizer |
| `856ace8b` | stabilityai/sd-turbo | SUCCEEDED | 12447.147 | 17999.729 | 1/2048 | latent |
| `16b6b04e` | stabilityai/sd-turbo | SUCCEEDED | 0 | 13996.766 | 1/2048 | latent |
| `83f22bb9` | black-forest-labs/FLUX.1-schnell | SUCCEEDED | 0 | 55339.009 | 1/4096 | latent |
| `8980b615` | black-forest-labs/FLUX.1-schnell | SUCCEEDED | 0 | 40177.053 | 1/4096 | latent |
| `1354e5b1` | openai/clip-vit-large-patch14 | SUCCEEDED | 15199.219 | 997.869 | 17/128 | multimodal_embedding |
| `39e13648` | openai/clip-vit-large-patch14 | SUCCEEDED | 0 | 789.473 | 17/128 | multimodal_embedding |
| `b72e5b61` | Lightricks/LTX-Video | SUCCEEDED | 195328.107 | 289619.576 | 1/1259 | spatiotemporal |
| `` | Lightricks/LTX-Video | ERROR | None | None | None/None | None |
