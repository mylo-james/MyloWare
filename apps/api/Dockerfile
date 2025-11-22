FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY README.md ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY apps ./apps
COPY adapters ./adapters
COPY content ./content
COPY core ./core
COPY infrastructure ./infrastructure
COPY data ./data

RUN pip install --upgrade pip && pip install --no-cache-dir .

RUN groupadd -r app && useradd -r -g app app && mkdir -p /app/data /app/logs && chown -R app:app /app

USER app

EXPOSE 8080

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080"]
