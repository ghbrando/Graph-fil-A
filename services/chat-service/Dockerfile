# chat-service — Python 3.11 + Flask + gunicorn
FROM python:3.11-slim

# Prevent .pyc files and enable unbuffered stdout/stderr (better Cloud Run logging)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install Python dependencies first (layer-cached unless requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Cloud Run injects PORT at runtime (default 8080)
ENV PORT=8080

# 1 worker (Cloud Run scales via instances), 8 threads for concurrent requests.
# 60s timeout — chat replies are fast; longer waits should fail fast.
CMD exec gunicorn \
    --bind "0.0.0.0:${PORT}" \
    --workers 1 \
    --threads 8 \
    --timeout 60 \
    --access-logfile - \
    --error-logfile - \
    main:app
