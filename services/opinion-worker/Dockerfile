FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/tmp/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates gosu libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir torch==2.13.0+cpu --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

ARG EMBEDDING_MODEL=intfloat/multilingual-e5-small
ARG EMBEDDING_MODEL_REVISION=614241f622f53c4eeff9890bdc4f31cfecc418b3
RUN python -c "from sentence_transformers import SentenceTransformer; model = SentenceTransformer('${EMBEDDING_MODEL}', revision='${EMBEDDING_MODEL_REVISION}', device='cpu'); model.save('/opt/opinion-model')" \
    && rm -rf /tmp/huggingface

ENV HF_HUB_OFFLINE=1 \
    EMBEDDING_MODEL_PATH=/opt/opinion-model

COPY docker-entrypoint.sh /usr/local/bin/opinion-worker-entrypoint
COPY worker.py ./
COPY evaluation ./evaluation

RUN useradd --create-home --uid 10001 worker \
    && chown -R worker:worker /app /opt/opinion-model \
    && chmod 755 /usr/local/bin/opinion-worker-entrypoint

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD test -f /tmp/opinion-worker.ready || exit 1

ENTRYPOINT ["opinion-worker-entrypoint"]
CMD ["python", "worker.py"]
