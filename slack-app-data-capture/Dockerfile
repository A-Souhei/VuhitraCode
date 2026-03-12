# Stage 1: Builder
FROM python:3.12-alpine AS builder

RUN apk add --no-cache --virtual .build-deps \
    gcc \
    musl-dev \
    linux-headers

WORKDIR /build

COPY requirements.txt .

RUN pip install --no-cache-dir --no-compile \
    --prefix=/install \
    -r requirements.txt

# Stage 2: Final
FROM python:3.12-alpine

# Install wget for healthcheck
RUN apk add --no-cache wget

# Create non-root user
RUN addgroup -S appuser && adduser -S appuser -G appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application code
COPY main.py __init__.py requirements.txt ./

# Create data directory with correct permissions
RUN mkdir -p /app/data && chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
    CMD wget -qO- http://localhost:8080/health || exit 1

# Labels
LABEL maintainer="Your Organization" \
      version="1.0.0" \
      description="FastAPI gateway application for Slack app data capture"

# Entrypoint
ENTRYPOINT ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
