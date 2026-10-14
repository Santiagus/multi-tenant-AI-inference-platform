# Test Media Fixtures (Images & Videos)

Deterministic, lightweight media fixtures for local development, unit/integration testing, Two-Path orchestration benchmarks, and computer vision / media diffusion experiments.

## Fixture Catalog

| File | Category | Modality | Dimensions / Duration | File Size | Source & Attribution | Recommended Test Use Case |
|---|---|---|---|---|---|---|
| `cat.jpg` | Pet / Animal | Image (JPEG) | 600 × 400 | ~32 KB | [Google MediaPipe Assets](https://storage.googleapis.com/mediapipe-assets/cat.jpg) | Domestic pet identification, segmentation, background removal |
| `dog.jpg` | Pet / Animal | Image (JPEG) | 1546 × 1213 | ~646 KB | [PyTorch Hub Image Samples](https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg) | Golden Retriever pet identification, classification, bounding-box detection |
| `portrait_person.jpg` | Human / Portrait | Image (JPEG) | 820 × 1024 | ~173 KB | [Google MediaPipe Selfie Segmentation](https://storage.googleapis.com/mediapipe-assets/portrait.jpg) | Portrait matting, background removal, virtual background replacement, relighting |
| `jorge_martin_motogp.jpg` | Athlete / MotoGP | Image (JPEG) | 960 × 1281 | ~204 KB | [Wikimedia Commons (CC BY-SA)](https://commons.wikimedia.org/wiki/File:Jorge_Martin_at_the_2023_Japanese_motorcycle_Grand_Prix_(3x4_cropped).jpg) | MotoGP world champion rider identification, leathers/helmet segmentation, sports motion styling |
| `fernando_alonso_f1.jpg` | Athlete / Formula 1 | Image (JPEG) | 960 × 1268 | ~158 KB | [Wikimedia Commons (CC BY-SA)](https://commons.wikimedia.org/wiki/File:FIA_F1_Austria_2022_Fernando_Alonso_cropped).jpg) | Formula 1 champion driver identification, race suit segmentation, portrait matting |
| `lamine_yamal_spain.jpg` | Athlete / Football | Image (JPEG) | 960 × 640 | ~87 KB | [Wikimedia Commons (CC BY-SA)](https://commons.wikimedia.org/wiki/File:Lamine_Yamal_Argentina_v_Spain_19_July_2026-133.jpg) | Spain national football team player identification, kit segmentation, pitch action analysis |
| `fruits_objects.jpg` | Multiple Objects | Image (JPEG) | 512 × 480 | ~81 KB | [OpenCV Samples Data](https://raw.githubusercontent.com/opencv/opencv/5.x/samples/data/fruits.jpg) | Multi-class object segmentation, still life fruit identification |
| `opencv_logo.png` | Graphic / Alpha | Image (PNG) | 512 × 512 (RGBA) | ~40 KB | [OpenCV Samples Data](https://raw.githubusercontent.com/opencv/opencv/5.x/samples/data/opencv-logo.png) | Alpha channel transparency testing, overlay compositing, watermark removal |
| `sample_keyframe.png` | Synthetic / Keyframe | Image (PNG) | 64 × 64 (RGB) | 165 B | In-repo generator | Fast deterministic unit tests, minimal keyframe condition |
| `sample_bunny_clip.mp4` | Animal / Animation | Video (H.264/MP4) | 640 × 360, 24fps, 10s | ~968 KB | [Peach Open Movie / Big Buck Bunny](https://test-videos.co.uk) | Video-to-video modification, style transfer, frame conditioning, temporal coherence |
| `sample_action_clip.mp4` | Human / Action | Video (H.264/MP4) | 320 × 240, 29.97fps, ~2s | [PyTorch Vision Assets (Kinetics-400)](https://raw.githubusercontent.com/pytorch/vision/main/test/assets/videos/SOX5yA1l24A.mp4) | ~548 KB | Human motion tracking, optical flow extraction, video inpainting |
| `sample_clip.mp4` | Synthetic / Test | Video (ISO-BMFF) | Synthetic | 227 B | In-repo generator | Ultra-fast unit testing, container header validation |

## Binary Verification & Container Inspection

The worker pipeline inspects local assets via `inspect_local_media_asset` in `apps/worker/flyte_workflow.py`:
- **PNG**: Validates `\x89PNG\r\n\x1a\n` signature, extracts width and height from the `IHDR` chunk.
- **JPEG**: Validates SOI marker `\xff\xd8`, extracts width and height from Start of Frame (`SOF0` / `SOF2`) marker segments.
- **MP4**: Validates ISO-BMFF `ftyp` atom header and confirms `moov` / `mdat` atom presence.
- **Content Integrity**: Computes SHA-256 digest of binary payload for Flyte's S3 memoization caching (`flyte_cache_hit`).

## Usage in API & REST Requests

You can reference any of these fixtures directly in `request.rest` or via `POST /v1/cloud/aws/workflows/execute`:

```json
{
  "path": "path_b_flyte_dag",
  "modality": "video_to_video",
  "job_id": "job-pet-style-transfer",
  "tenant_id": "tenant-enterprise-01",
  "model_id": "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
  "prompt": "Apply stylized watercolor filter to animal while preserving motion.",
  "asset_uri": "tests/fixtures/media/cat.jpg",
  "edit_operation": "style_transfer",
  "edit_strength": 0.8
}
```

