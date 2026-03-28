# syntax=docker/dockerfile:1
FROM python:3.12-slim

# Security: run as a non-root user
RUN addgroup --system app && adduser --system --ingroup app app

WORKDIR /app

# Install dependencies (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY app.py .

USER app

EXPOSE 5000

# Use gunicorn in production; tune workers based on CPU count
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "30", "app:app"]
