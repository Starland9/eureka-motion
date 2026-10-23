# syntax=docker/dockerfile:1
# Build from this directory: docker build workers/voice-pocket
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
  pip install -r requirements.txt

COPY server.py .

# A new named volume takes the owner of /data/hf.
RUN useradd --uid 10001 --create-home pocket \
  && install -d -o pocket -g pocket -m 0755 /data/hf
USER pocket

ENV HF_HOME=/data/hf POCKET_PORT=8890
EXPOSE 8890

# The first start downloads the weights of every configured language.
HEALTHCHECK --interval=15s --timeout=5s --start-period=900s --retries=4 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ['POCKET_PORT'], timeout=3)"]

CMD ["sh", "-c", "exec uvicorn --factory server:create_app --host 0.0.0.0 --port $POCKET_PORT"]
