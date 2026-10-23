import json
import logging
import os
import re
import threading
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Any, Protocol

import lameenc
import numpy as np
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

MAX_INPUT_CHARS = 200
MAX_BODY_BYTES = 16 * 1024
MP3_KBPS = 64
DEFAULT_VOICES = "estelle:fr,alba:en"
DEFAULT_PORT = 8890
POCKET_MODELS = {"fr": "french", "en": "english"}
VOICE_NAME = re.compile(r"[a-z][a-z0-9_]{0,31}")

logger = logging.getLogger("uvicorn.error")
# text_chunking logs the first characters of long chunks
logging.getLogger("pocket_tts.models.text_chunking").setLevel(logging.ERROR)


class SpeechModel(Protocol):
    sample_rate: int

    def synthesize(self, voice: str, text: str) -> np.ndarray: ...


ModelLoader = Callable[[str, list[str]], SpeechModel]


class LoadError(Exception):
    def __init__(self, missing: str):
        super().__init__(missing)
        self.missing = missing


def parse_voices(raw: str) -> dict[str, str]:
    voices: dict[str, str] = {}
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        name, _, language = item.partition(":")
        name, language = name.strip(), language.strip()
        if not VOICE_NAME.fullmatch(name) or language not in POCKET_MODELS:
            raise ValueError(f"invalid POCKET_VOICES entry: {item!r}")
        voices[name] = language
    if not voices:
        raise ValueError("POCKET_VOICES lists no voice")
    return voices


def encode_mp3(samples: np.ndarray, sample_rate: int) -> bytes:
    if samples.size == 0:
        raise ValueError("no audio produced")
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(MP3_KBPS)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_quality(2)
    return bytes(encoder.encode(pcm.tobytes())) + bytes(encoder.flush())


class PocketModel:
    def __init__(self, model: Any, states: dict[str, Any]):
        self._model = model
        self._states = states
        self.sample_rate: int = model.sample_rate

    def synthesize(self, voice: str, text: str) -> np.ndarray:
        audio = self._model.generate_audio(self._states[voice], text)
        return audio.float().cpu().numpy().reshape(-1)


def load_pocket_model(language: str, voices: list[str]) -> SpeechModel:
    from pocket_tts import TTSModel

    model_name = POCKET_MODELS[language]
    try:
        model = TTSModel.load_model(language=model_name)
    except Exception as exc:
        raise LoadError(f"model:{model_name}") from exc
    if model.has_voice_cloning:
        raise LoadError(f"weights without voice cloning:{model_name}")
    states = {}
    for voice in voices:
        try:
            states[voice] = model.get_state_for_audio_prompt(voice)
        except Exception as exc:
            raise LoadError(f"voice:{voice}") from exc
    return PocketModel(model, states)


class VoiceService:
    def __init__(self, loader: ModelLoader, voices: dict[str, str]):
        self.voices = voices
        self.languages = list(dict.fromkeys(voices.values()))
        self._loader = loader
        self._models: dict[str, SpeechModel] = {}
        self._status = "loading"
        self._missing = ""
        self._synthesis_lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self._status == "ready"

    def start(self) -> threading.Thread:
        thread = threading.Thread(target=self.load, name="model-loader", daemon=True)
        thread.start()
        return thread

    def load(self) -> None:
        language = ""
        try:
            models: dict[str, SpeechModel] = {}
            for language in self.languages:
                names = [name for name, lang in self.voices.items() if lang == language]
                models[language] = self._loader(language, names)
        except LoadError as exc:
            logger.error("loading failed: %s", exc.missing, exc_info=exc.__cause__)
            self._missing = exc.missing
            self._status = "failed"
        except Exception:
            logger.exception("loading the %s model failed", language)
            self._missing = f"model:{language}"
            self._status = "failed"
        else:
            self._models = models
            self._status = "ready"
            logger.info("voices ready: %s", ",".join(self.voices))

    def health(self) -> tuple[int, dict[str, Any]]:
        if self._status == "ready":
            return 200, {"status": "healthy", "languages": self.languages}
        if self._status == "failed":
            return 503, {"status": "failed", "missing": self._missing}
        return 503, {"status": "loading"}

    def speak(self, voice: str, text: str) -> bytes:
        model = self._models[self.voices[voice]]
        with self._synthesis_lock:
            samples = model.synthesize(voice, text)
        return encode_mp3(samples, model.sample_rate)


def error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


def create_app(
    load_model: ModelLoader = load_pocket_model,
    voices: dict[str, str] | None = None,
    autostart: bool = True,
) -> FastAPI:
    if voices is None:
        voices = parse_voices(os.environ.get("POCKET_VOICES", DEFAULT_VOICES))
    service = VoiceService(load_model, voices)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if autostart:
            service.start()
        yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.service = service

    @app.get("/health")
    def health() -> JSONResponse:
        status, body = service.health()
        return JSONResponse(body, status_code=status)

    @app.post("/v1/audio/speech")
    async def speech(request: Request) -> Response:
        if not service.ready:
            return error(503, "loading")

        raw = await request.body()
        if len(raw) > MAX_BODY_BYTES:
            return error(400, "input too long")
        try:
            body = json.loads(raw)
        except (ValueError, RecursionError):
            return error(400, "invalid body")
        if not isinstance(body, dict):
            return error(400, "invalid body")

        text = body.get("input")
        text = text.strip() if isinstance(text, str) else ""
        if not text:
            return error(400, "empty input")
        if len(text) > MAX_INPUT_CHARS:
            return error(400, "input too long")

        voice = body.get("voice")
        if not isinstance(voice, str) or voice not in service.voices:
            return error(400, "unknown voice")

        if body.get("response_format", "mp3") != "mp3":
            return error(400, "unsupported format")

        try:
            mp3 = await run_in_threadpool(service.speak, voice, text)
        except Exception as exc:
            logger.error("synthesis failed: %s", type(exc).__name__)
            return error(500, "synthesis failed")
        return Response(content=mp3, media_type="audio/mpeg")

    return app


if __name__ == "__main__":
    port = int(os.environ.get("POCKET_PORT", DEFAULT_PORT))
    uvicorn.run(create_app(), host="127.0.0.1", port=port)
