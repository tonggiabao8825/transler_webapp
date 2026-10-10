# Core engine: quality-constrained latency strategy

Research reviewed on 2026-10-09. This is a proposed optimization strategy, not a description of deployed capabilities. Existing architecture and preservation invariants are defined in [architecture.md](architecture.md).

## Decision

Keep BabelDOC responsible for native PDF layout and Scan Engine responsible for scanned-image replacement. Accelerate their inference and shared Translation Gateway independently. Select the fastest configuration that passes document-quality checks; there is no verified market-wide winner for Transler's exact workload.

The leading deployment candidate is a warm, GPU-backed layout/OCR service plus isolated PDF composition runners, with official machine-translation APIs for Basic and an online LLM provider for specialized translation. GPU model compatibility, language coverage and PDF quality must be benchmarked before adoption. Do not replace layout reconstruction with a generic document-to-Markdown parser.

## Primary-source evidence

| Candidate | Published capability | Implication for Transler |
| --- | --- | --- |
| [BabelDOC](https://github.com/funstory-ai/BabelDOC) | Native document translation and layout reconstruction. | Retain the full-document adapter and selected-page map; verify installed-version capabilities before parallelizing page ranges. |
| [PaddleOCR PP-OCRv6](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv6/PP-OCRv6.en.md) | Vendor benchmark covers 200 images with I/O and pre/postprocessing. On A100/Paddle: medium 0.29 s/image, small 0.25, tiny 0.13. Recognition accuracy on its separate in-house benchmark: medium 83.2%, small 81.3%, tiny 73.5%. | Benchmark medium/small against pinned v5 language-specific models. Tiny sacrifices accuracy and is not the quality-first default. These are OCR measurements, not translated-PDF latency. |
| Same PaddleOCR benchmark | A100 small: Paddle 0.25 s/image versus TensorRT 0.32. Apple M4 small: Paddle 3.07 versus ONNX Runtime 1.29. | Test backend/model/hardware combinations; TensorRT is not universally faster. Mac measurements do not establish GPU acceleration inside Linux Docker on that Mac. |
| [ONNX Runtime TensorRT provider](https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html) | Engine/timing caches and dynamic-shape profiles avoid repeated compilation; caches depend on model, runtime and GPU compatibility. | Keep inference warm; compile at deployment, not per PDF. Benchmark CUDA against TensorRT with actual layout tensors. Explicit accelerator configuration must fail clearly if unavailable. |
| [Groq models](https://console.groq.com/docs/models) | GPT-OSS 20B published speed approximately 1,000 tokens/s. | Current provider remains a strong baseline. Published decoding speed excludes the complete PDF pipeline and account-specific contention. |
| [Cerebras model catalog](https://inference-docs.cerebras.ai/models/overview) | GPT-OSS 120B published speed approximately 3,000 tokens/s. | Priority challenger for specialized translation. Different model sizes prevent a like-for-like speed or quality conclusion; benchmark translation directly. |
| [Groq prompt caching](https://console.groq.com/docs/prompt-caching) | GPT-OSS supports automatic exact-prefix caching; hits are not guaranteed. | Place stable instructions, schema, glossary and document context before changing region text. Measure cached tokens and request latency. Provider prefix caching complements Transler's completed-translation cache. |
| [Groq reasoning](https://console.groq.com/docs/reasoning) | GPT-OSS accepts low, medium and high reasoning effort. | A/B test explicit low versus current default; adopt only if terminology and meaning remain acceptable. |
| [DeepL text API](https://developers.deepl.com/api-reference/translate/request-translation) | Multiple texts, context and explicit model selection. [Official SDK](https://github.com/DeepL/deepl-python) describes latency-optimized as a quality tradeoff. [Language capabilities](https://developers.deepl.com/docs/getting-started/supported-languages) are available programmatically. | Benchmark official Basic translation; query pair-specific capabilities, including Vietnamese. Reject unsupported configuration rather than silently switch models/providers. |
| [Azure Translator limits](https://learn.microsoft.com/en-us/azure/ai-services/translator/service-limits) | Supports multi-item translation requests under documented character limits. | Second Basic benchmark candidate; batching can reduce HTTP overhead but must preserve paragraph/cell boundaries. |
| [Google document translation](https://docs.cloud.google.com/translate/docs/advanced/translate-documents) | Supports native and scanned PDFs with differing limits. | Useful end-to-end external baseline. Evaluate preservation and latency on the same corpus before considering an alternate adapter. |

No vendor above publishes a directly comparable benchmark for bilingual, layout-preserving translation of Transler's source PDF. Tokens/s, OCR images/s and document-extraction pages/s measure different work.

## Confirmed local costs

Code inspection identifies explicit CPU-only native ONNX inference, sequential scan recognition before native translation, one LLM request per translation segment, and cumulative PDF serialization after every assembled page. Navigation links are restored across all pages inside each page checkpoint. These costs need separate timings; inspection alone does not establish their percentage of total latency.

Existing three-page layout measurements under the same bounded CPU settings: before 34.830 s, after 36.654 s. Model initialization improved from 0.677 to 0.290 s, with peak memory 747.9 to 687.2 MB and identical layout checksums. This establishes initialization/memory improvement, not layout or full-document speedup.

## Implementation order

1. Instrument monotonic timings for queue wait, preflight, model load, layout, OCR, provider wait/request, restoration, composition, checkpoint serialization/upload, QA and final publication. Record token/cache usage, retry count and peak memory without logging document text or credentials.
2. Remove repeated whole-document work. Persist native results and scan preparations as validated stage artifacts so retries do not recompute completed inference. Design bounded checkpoint intervals and separate progress from durable publication. Retain unrenumbered live xrefs and final-only compaction; validate navigation on every published checkpoint. Do not repeat the previous font/metadata corruption by compacting a live grafted document.
3. Benchmark a long-lived external inference connector. Keep OCR/layout models warm in their own process; retain killable, isolated PDF runners and fenced publication. Start with one service rather than introducing a fleet of fine-grained Celery tasks. Measure request-transfer overhead and bounded concurrency before deployment.
4. Benchmark official Basic APIs and Groq/Cerebras specialized translation. Test small paragraph/cell batches with stable IDs, complete-result validation, protected-number checks and bounded RPM/TPM-aware concurrency. Native batching needs a connector that coalesces calls within a short bounded window while satisfying BabelDOC's synchronous contract. Avoid unbounded batching or splitting one line into one task.
5. Overlap independent preparation stages only after defining a shared context barrier. Native layout and OCR may overlap; translation must receive the intended document context. Each engine continues owning reconstruction. Cap shared CPU/GPU work to avoid resource contention.

## Acceptance benchmark

Use the existing 23-page scientific PDF plus separate white-background scan, simple-table scan, mixed/rotated PDF and multilingual cases. Test 1/10/30-page inputs, cold/warm execution, cache hits/misses, isolated requests and concurrent jobs. Record end-to-end P50/P95, time to first genuinely completed preview, provider cost, failures and resource usage. Report each hardware/model/version explicitly; never count a cached repeat as fresh-translation throughput.

Require correct page order/boxes/rotation, metadata/navigation preservation, readable embedded fonts, no broken Unicode or missing text, preserved figures/table rules, numbers/formulas and glossary checks. Evaluate OCR error rate against labeled text and translation meaning with bilingual review. Text-length ratios or successful rendering alone do not prove semantic quality. Choose the lowest measured end-to-end latency among configurations that satisfy these gates.

GPU and alternative-provider results remain unmeasured. Vendor speed claims are candidates for evaluation, not promises of a particular 30-page completion time.
