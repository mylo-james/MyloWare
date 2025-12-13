# =============================================================================
# MyloWare API Dockerfile
# =============================================================================

FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy all files needed for installation
COPY pyproject.toml README.md ./
COPY src/ ./src/

# Install Python dependencies (non-editable for production)
RUN pip install --no-cache-dir .

# Copy remaining application files
COPY data/ ./data/
COPY llama_stack/ ./llama_stack/
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY scripts/docker-entrypoint.sh ./

# Make entrypoint executable
RUN chmod +x docker-entrypoint.sh

# Set PYTHONPATH
ENV PYTHONPATH=/app/src

# Create non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 8000

# Health check (give time for migrations)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run migrations and start app
CMD ["./docker-entrypoint.sh"]
