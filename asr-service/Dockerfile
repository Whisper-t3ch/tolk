FROM python:3.11-slim

# ffmpeg — декодирование webm/opus дорожек; git — установка GigaAM с GitHub.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 app
WORKDIR /srv

# CPU-сборка torch (без CUDA) — на ВМ нет GPU.
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Закрепите GIGAAM_REF на конкретный коммит после первой успешной сборки
# (git ls-remote https://github.com/salute-developers/GigaAM HEAD).
ARG GIGAAM_REF=main
RUN pip install --no-cache-dir "gigaam @ git+https://github.com/salute-developers/GigaAM.git@${GIGAAM_REF}"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

USER app
ENV HOME=/home/app PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4).status==200 else 1)"

# Один воркер: модель одна, обработка сериализована семафором.
CMD ["uvicorn", "app.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-keep-alive", "120"]
