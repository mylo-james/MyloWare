FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY apps ./apps
COPY adapters ./adapters
COPY content ./content
COPY core ./core
COPY data ./data

RUN pip install --upgrade pip && pip install .

RUN groupadd -r app && useradd -r -g app app && mkdir -p /app/data /app/logs && chown -R app:app /app

USER app

EXPOSE 3000

CMD ["uvicorn", "mcp_adapter.main:app", "--host", "0.0.0.0", "--port", "3000"]
