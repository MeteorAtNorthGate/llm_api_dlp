FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libmagic1 \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Migrations run from the entrypoint, which works out the correct starting
# revision instead of blindly stamping. Invoked via `sh` rather than directly so
# it does not depend on the executable bit surviving a checkout.
CMD ["sh", "/app/docker-entrypoint.sh"]
