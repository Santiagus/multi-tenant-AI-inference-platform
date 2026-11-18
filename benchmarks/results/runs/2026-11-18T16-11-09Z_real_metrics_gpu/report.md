# Real metrics GPU harness — 2026-11-18T16-11-09Z

- Device: **NVIDIA GeForce RTX 5070 Ti** (15.9 GB)
- Measurement: **measured**
- Passed: **8/8**

| Model | Purpose | load_ms | inference_ms | in/out | accounting | OK |
|---|---|---:|---:|---|---|---|
| TinyLlama/TinyLlama-1.1B-Chat-v1.0 | text_to_text | 6426.714 | 3414.902 | 35/64 | tokenizer | yes |
| TinyLlama/TinyLlama-1.1B-Chat-v1.0 | text_to_text | 0.0 | 1767.541 | 37/80 | tokenizer | yes |
| stabilityai/sd-turbo | text_to_image | 4023.118 | 975.088 | 24/1024 | latent | yes |
| stabilityai/sd-turbo | text_to_image | 0.0 | 157.079 | 25/2048 | latent | yes |
| openai/clip-vit-large-patch14 | media_photo | 3149.047 | 124.541 | 17/128 | multimodal_embedding | yes |
| openai/clip-vit-large-patch14 | media_photo | 0.0 | 34.614 | 17/128 | multimodal_embedding | yes |
| Lightricks/LTX-Video | text_to_video | 630427.04 | 193786.329 | 30/1259 | spatiotemporal | yes |
| Lightricks/LTX-Video | text_to_video | 0.0 | 192360.045 | 33/1259 | spatiotemporal | yes |
