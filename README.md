# Transler

Document translation and processing with one modular Node.js/TypeScript API, separate Python workers, PostgreSQL, Redis, private S3 storage and React/PDF.js.

[Product requirements](docs/about.md) · [Architecture](docs/architecture.md)

## Run

Requires Docker Compose and Python 3 for the initial local configuration. Copy the configuration once and generate the encryption/internal API keys before starting:

```sh
cp .env.example .env
python3 - <<'PY'
from pathlib import Path
from secrets import token_hex
path = Path('.env')
content = path.read_text()
content = content.replace('replace-with-64-hex-characters-from-a-secure-random-generator', token_hex(32))
content = content.replace('replace-with-a-random-secret-at-least-32-characters', token_hex(32))
path.write_text(content)
path.chmod(0o600)
PY
docker compose up --build -d
```

Open **http://localhost:8080/** for the landing page. Authentication is at `/login` and `/register`; successful authentication opens `/dashboard`. Accounts are at `/account`, administration at `/admin`, the library at `/documents`, and OpenAPI at `/docs/`. `/welcome` redirects to `/`.

Compose packages PostgreSQL and preserves its existing `postgres-data` volume. Migrations and private storage provisioning run before the API starts. The first PDF translation downloads layout models and fonts into a persistent worker cache. Keep one beat scheduler per deployment.

For a hosted deployment, supply database/storage secrets, terminate HTTPS, set `TRANSLER_SECURE_COOKIE=true` and `TRANSLER_PUBLIC_URL` to the public origin. Preserve `TRANSLER_SETTINGS_KEY` with database backups: payment credentials and PDF passwords are encrypted using this key. `.env` is ignored by Git.

## Processing

- PDF Basic uses PDFMathTranslate with the configured Basic provider. Advanced uses Groq, document context, domain, custom instructions and glossary. Configure `API_PROVIDER=groq`, `LLM_MODEL=openai/gpt-oss-20b`, `LLM_BASE_URL=https://api.groq.com/openai/v1` and `LLM_API_KEY` in `.env` before starting the worker.
- PDF editing supports text replacement/addition/deletion, moving/resizing blocks, annotations, cropping, rotating/deleting/reordering pages and translating a selected region. Text-free regions use Tesseract OCR. Save creates an immutable revision; conflicting revisions are rejected.
- PDF converts to DOCX, PPTX, XLSX, PNG/JPEG ZIP, HTML, TXT and Markdown. Office, images and text convert to PDF. PPTX exports page images; XLSX requires detectable tables. TXT/Markdown PDF extraction provides plain text. LibreOffice renders Office inputs inside the worker.
- DOCX/PPTX/XLSX, UTF-8 TXT, Markdown and HTML translate through Groq while retaining native structures. Office formulas, Markdown code and link destinations, and HTML attributes remain unchanged. HTML rendering requires embedded resources and rejects external resource fetching.
- OCR adds searchable text to scanned PDF pages while retaining their source images. Run image-to-PDF conversion first for image OCR. Available OCR languages match the ten translation languages; auto uses English and Vietnamese.
- My Documents retains raw files and all processed artifacts. Favorites, Trash/restore, permanent deletion and expiring/revocable download links are available. Guest workspaces expire after seven days; registered libraries persist.
- Queued jobs support progress, cancellation, retry, lease recovery, page checkpoints and persisted completed LLM units. Protected numbers, formula placeholders, code and configured glossary targets are checked before publication. PDF quality reports are heuristics, not certification of translation accuracy.

Uploads are limited to 20 MB and 30 pages/units. Office/text usage uses 2,000 source characters per unit; presentations use slides. Concurrent jobs and monthly usage follow the account plan. Raw files are never overwritten. Unsupported formats, overflow and provider failures produce explicit errors; providers are never switched automatically.

## Accounts, billing and integration

My account shows the current plan, expiry, used/reserved monthly pages, storage, daily statistics, CSV reports, profile and password settings. Administration manages users/roles/access, creates and edits plans, configures payment gateways, reviews payments and exposes reports/audit events.

Create the first administrator with a password supplied through the calling environment:

```sh
docker compose exec -e TRANSLER_ADMIN_PASSWORD api node dist/admin-bootstrap.js --email admin@example.com --name Administrator
```

The password must contain at least 12 characters. There is no built-in administrator password. Additional administrators are granted through Administration; at least one active administrator is retained. Password changes revoke browser sessions.

Configure SePay and Stripe/card in **Administration → Gateways**, and set separate monthly/yearly VND/USD-cent prices in **Plans**. Yearly purchases grant 365 days; monthly purchases grant 30 days. Usage allowances remain per calendar month. Prices and production payment credentials are initially unset. Credentials are encrypted in PostgreSQL and never returned to the browser. Pending orders prevent gateway changes that would invalidate checkout instructions.

SePay webhook: `https://YOUR_HOST/v1/billing/webhooks/sepay`, API-key authorization using the `Apikey` scheme. Stripe webhook: `https://YOUR_HOST/v1/billing/webhooks/stripe`, signed events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Card checkout is hosted by Stripe; card details are not stored by Transler. Verified matching webhooks activate prepaid plans exactly once, without automatic renewal. Mismatched/expired payments require audited review. Checkout redirects do not prove payment. Live checkout requires configured provider credentials and reachable HTTPS webhooks.

Create/revoke expiring API keys in My account. Use `Authorization: Bearer <key>` for owned document and processing endpoints; browser authentication is required for account and admin actions. `/v1/operations` accepts typed Advanced, editing, conversion, OCR and PDF-tool requests. Billing checkout requires an explicit `billing_cycle` (`monthly` or `yearly`); each order snapshots its cycle, price and duration. Use an `Idempotency-Key` UUID, then poll `/v1/jobs/{id}` and download its artifact. OpenAPI documents request contracts.

The web app includes a manifest/service worker for desktop browser installation. It uses the same API and requires connectivity; file bytes and account responses are not cached offline.

## Development and checks

Requires Python 3.12, uv, Node 22+ and Docker Compose infrastructure:

```sh
make install
make infra
make migrate
```

Run `make api`, `make processor`, `make worker`, `make beat`, and `make web` in separate terminals. Do not run local and Compose workers against the same development database simultaneously.

```sh
make check
make test
make test-translation
make test-browser
```

Integration tests use a separate `transler_test` database, Redis DB 15 and test bucket. Conversion/OCR matrix tests execute inside the running Docker worker for LibreOffice/Tesseract dependencies; keep the full stack running for these tests. Translation tests call actual configured providers. Browser tests use stable test IDs. `npm --prefix frontend run test:production` exercises the production Nginx deployment; its admin test uses the ignored `.runtime/admin-credentials.json` fixture for an existing administrator. Browser registration tests create real accounts in the target development deployment.

PDFMathTranslate 1.9.11 requires the pinned PyMuPDF 1.25.2 and compatible Tencent SDK. Dependency resolutions are locked. PDFMathTranslate/PyMuPDF are AGPL dependencies. UI references are in `img/`; independent branding and illustration assets come from `transler_assets_v2`.
