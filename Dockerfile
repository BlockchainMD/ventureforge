FROM python:3.11-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install deps first for layer caching
COPY pyproject.toml .
COPY ventureforge/ ventureforge/
RUN pip install --no-cache-dir .

# Development stage
FROM base AS dev
RUN pip install --no-cache-dir ".[dev]"
COPY . .
CMD ["uvicorn", "ventureforge.api:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# Frontend build stage
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install
COPY frontend/ .
RUN npm run build

# Production stage
FROM base AS prod

# Copy prompt YAML files and examples
COPY ventureforge/ ventureforge/
COPY examples/ examples/

# Copy frontend build
COPY --from=frontend-build /frontend/dist/ frontend/dist/

RUN useradd -m -r appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080
CMD ["sh", "-c", "uvicorn ventureforge.api:app --host 0.0.0.0 --port ${PORT:-8080} --workers 2"]
