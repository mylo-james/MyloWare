# Use pgvector's official image (based on Postgres 17)
FROM pgvector/pgvector:pg17

# Set environment variables
ENV POSTGRES_DB=myloware
ENV POSTGRES_USER=postgres
ENV POSTGRES_PASSWORD=postgres

# Copy initialization script
COPY init.sql /docker-entrypoint-initdb.d/

# Expose Postgres port
EXPOSE 5432

