FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for cryptography and other packages
RUN apt-get update && apt-get install -y \
    build-essential \
    libssl-dev \
    libffi-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY VERSION ./VERSION

EXPOSE 8021

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8021"]
