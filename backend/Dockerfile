FROM ghcr.io/astral-sh/uv:0.12.15 AS uv
FROM python:3.12-slim AS base
COPY --from=uv /uv /usr/local/bin/uv
RUN groupadd --gid 10001 transler && useradd --uid 10001 --gid transler --create-home transler
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

FROM base AS api
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/src ./src
COPY backend/alembic.ini ./alembic.ini
COPY backend/migrations ./migrations
RUN uv sync --frozen --no-dev
USER transler

FROM base AS worker
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 libgomp1 libreoffice-writer libreoffice-calc libreoffice-impress \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-vie tesseract-ocr-chi-sim tesseract-ocr-jpn \
    tesseract-ocr-kor tesseract-ocr-fra tesseract-ocr-deu tesseract-ocr-spa tesseract-ocr-por \
    tesseract-ocr-rus fonts-noto-core fonts-noto-cjk libpango-1.0-0 libpangoft2-1.0-0 \
    && rm -rf /var/lib/apt/lists/*
RUN uv sync --frozen --no-dev --extra worker --no-install-project
COPY backend/src ./src
RUN uv sync --frozen --no-dev --extra worker \
    && mkdir -p /home/transler/.cache /home/transler/.config \
    && chown -R transler:transler /home/transler
USER transler
