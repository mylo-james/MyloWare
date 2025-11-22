FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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

EXPOSE 8090

CMD ["uvicorn", "orchestrator.server:app", "--host", "0.0.0.0", "--port", "8090"]
