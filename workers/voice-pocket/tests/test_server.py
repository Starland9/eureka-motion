import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from fastapi.testclient import TestClient

import server
from server import LoadError, create_app, parse_voices

SAMPLE_RATE = 24000
VOICES = {"estelle": "fr", "alba": "en"}
MPEG2_LAYER3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]


class FakeModel:
    sample_rate = SAMPLE_RATE

    def __init__(self, seconds=1.0, delay=0.0, fail=False):
        self.seconds = seconds
        self.delay = delay
        self.fail = fail
        self.calls = []
        self.active = 0
        self.max_active = 0
        self._guard = threading.Lock()

    def synthesize(self, voice, text):
        with self._guard:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            self.calls.append((voice, text))
            if self.fail:
                raise RuntimeError(f"boom on {text}")
            time.sleep(self.delay)
            t = np.arange(int(SAMPLE_RATE * self.seconds)) / SAMPLE_RATE
            return (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
        finally:
            with self._guard:
                self.active -= 1


def fake_loader(models):
    calls = []

    def load(language, voices):
        calls.append((language, voices))
        return models[language]

    load.calls = calls
    return load


def mp3_info(data):
    pos = 0
    frames = 0
    first = None
    while pos + 4 <= len(data):
        header = int.from_bytes(data[pos : pos + 4], "big")
        assert header >> 21 == 0x7FF, f"no frame sync at {pos}"
        version = (header >> 19) & 3
        layer = (header >> 17) & 3
        bitrate = MPEG2_LAYER3_KBPS[(header >> 12) & 15] * 1000
        rate = {0: 22050, 1: 24000, 2: 16000}[(header >> 10) & 3]
        padding = (header >> 9) & 1
        channel_mode = (header >> 6) & 3
        assert version == 2 and layer == 1
        first = first or (rate, channel_mode)
        pos += 72 * bitrate // rate + padding
        frames += 1
    assert pos == len(data)
    return first[0], first[1], frames * 576 / first[0]


def ready_client(models=None, voices=None):
    models = models or {"fr": FakeModel(), "en": FakeModel()}
    app = create_app(fake_loader(models), voices or VOICES, autostart=False)
    app.state.service.load()
    return TestClient(app), models


def speak(client, **overrides):
    body = {
        "model": "pocket",
        "input": "Tu veux mesurer la pièce.",
        "voice": "estelle",
        "response_format": "mp3",
    }
    body.update(overrides)
    return client.post("/v1/audio/speech", json=body)


def test_health_loading_before_models_are_loaded():
    app = create_app(fake_loader({}), VOICES, autostart=False)
    response = TestClient(app).get("/health")
    assert response.status_code == 503
    assert response.json() == {"status": "loading"}


def test_health_healthy_lists_languages():
    client, _ = ready_client()
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "languages": ["fr", "en"]}


def test_health_failed_names_the_missing_voice():
    def load(language, voices):
        raise LoadError("voice:estelle")

    app = create_app(load, VOICES, autostart=False)
    app.state.service.load()
    response = TestClient(app).get("/health")
    assert response.status_code == 503
    assert response.json() == {"status": "failed", "missing": "voice:estelle"}


def test_health_failed_names_the_model_on_unexpected_error():
    def load(language, voices):
        raise OSError("weights not found")

    app = create_app(load, VOICES, autostart=False)
    app.state.service.load()
    assert TestClient(app).get("/health").json() == {"status": "failed", "missing": "model:fr"}


def test_models_load_in_a_background_thread_at_startup():
    release = threading.Event()
    models = {"fr": FakeModel(), "en": FakeModel()}

    def load(language, voices):
        release.wait(5)
        return models[language]

    with TestClient(create_app(load, VOICES)) as client:
        assert client.get("/health").status_code == 503
        assert client.get("/health").json() == {"status": "loading"}
        release.set()
        for _ in range(100):
            if client.get("/health").status_code == 200:
                break
            time.sleep(0.05)
        assert client.get("/health").json()["status"] == "healthy"


def test_each_language_gets_its_own_model_with_its_voices():
    loader = fake_loader({"fr": FakeModel(), "en": FakeModel()})
    app = create_app(loader, {"estelle": "fr", "alba": "en", "jean": "en"}, autostart=False)
    app.state.service.load()
    assert loader.calls == [("fr", ["estelle"]), ("en", ["alba", "jean"])]


def test_speech_returns_a_readable_mono_mp3_of_about_one_second():
    client, _ = ready_client()
    response = speak(client)
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    rate, channel_mode, duration = mp3_info(response.content)
    assert rate == SAMPLE_RATE
    assert channel_mode == 3
    assert duration == pytest.approx(1.0, abs=0.1)


def test_voice_selects_the_model_of_its_language():
    models = {"fr": FakeModel(seconds=1.0), "en": FakeModel(seconds=2.0)}
    client, _ = ready_client(models)
    assert mp3_info(speak(client, voice="estelle").content)[2] == pytest.approx(1.0, abs=0.1)
    assert mp3_info(speak(client, voice="alba").content)[2] == pytest.approx(2.0, abs=0.1)
    assert [c[0] for c in models["fr"].calls] == ["estelle"]
    assert [c[0] for c in models["en"].calls] == ["alba"]


def test_model_stream_and_unknown_fields_are_ignored():
    client, _ = ready_client()
    assert speak(client, model="whatever", stream=True, speed=2).status_code == 200


def test_response_format_defaults_to_mp3():
    client, _ = ready_client()
    response = client.post("/v1/audio/speech", json={"input": "Bonjour.", "voice": "estelle"})
    assert response.status_code == 200


def test_input_is_stripped_before_synthesis():
    client, models = ready_client()
    assert speak(client, input="   Bonjour.  \n").status_code == 200
    assert models["fr"].calls == [("estelle", "Bonjour.")]


@pytest.mark.parametrize("value", ["", "   \n\t ", None, 12, ["a"]])
def test_empty_or_non_string_input_is_a_400(value):
    client, _ = ready_client()
    response = speak(client, input=value)
    assert response.status_code == 400
    assert response.json() == {"error": "empty input"}


def test_missing_input_is_a_400():
    client, _ = ready_client()
    response = client.post("/v1/audio/speech", json={"voice": "estelle"})
    assert response.status_code == 400
    assert response.json() == {"error": "empty input"}


def test_input_of_200_characters_is_accepted_even_when_padded_with_spaces():
    client, _ = ready_client()
    assert speak(client, input="a" * 200).status_code == 200
    assert speak(client, input="  " + "a" * 200 + "  ").status_code == 200


def test_input_of_201_characters_is_a_400():
    client, models = ready_client()
    response = speak(client, input="a" * 201)
    assert response.status_code == 400
    assert response.json() == {"error": "input too long"}
    assert models["fr"].calls == []


def test_oversized_body_is_a_400():
    client, _ = ready_client()
    response = speak(client, input="a" * 100_000)
    assert response.status_code == 400
    assert response.json() == {"error": "input too long"}


@pytest.mark.parametrize(
    "voice",
    [
        "unknown",
        "",
        None,
        7,
        "Estelle",
        "https://example.org/voice.wav",
        "hf://kyutai/tts-voices/alba-mackenna/casual.wav",
        "../voice.wav",
        "/etc/passwd",
    ],
)
def test_unknown_voice_or_voice_address_is_a_400(voice):
    client, models = ready_client()
    response = speak(client, voice=voice)
    assert response.status_code == 400
    assert response.json() == {"error": "unknown voice"}
    assert models["fr"].calls == [] and models["en"].calls == []


def test_missing_voice_is_a_400():
    client, _ = ready_client()
    response = client.post("/v1/audio/speech", json={"input": "Bonjour."})
    assert response.status_code == 400
    assert response.json() == {"error": "unknown voice"}


@pytest.mark.parametrize("fmt", ["wav", "opus", "MP3", "", None])
def test_other_response_format_is_a_400(fmt):
    client, _ = ready_client()
    response = speak(client, response_format=fmt)
    assert response.status_code == 400
    assert response.json() == {"error": "unsupported format"}


@pytest.mark.parametrize("raw", [b"not json", b"[1, 2]", b"\xff\xfe", b""])
def test_body_that_is_not_a_json_object_is_a_400(raw):
    client, _ = ready_client()
    response = client.post(
        "/v1/audio/speech", content=raw, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json() == {"error": "invalid body"}


def test_uploaded_voice_file_is_not_accepted():
    client, models = ready_client()
    response = client.post(
        "/v1/audio/speech",
        data={"input": "Bonjour.", "voice": "estelle"},
        files={"voice_wav": ("v.wav", b"RIFF....", "audio/wav")},
    )
    assert response.status_code == 400
    assert models["fr"].calls == []


def test_speech_is_a_503_while_models_are_loading():
    app = create_app(fake_loader({}), VOICES, autostart=False)
    response = speak(TestClient(app))
    assert response.status_code == 503
    assert response.json() == {"error": "loading"}


def test_speech_is_a_503_when_loading_failed():
    def load(language, voices):
        raise LoadError("voice:estelle")

    app = create_app(load, VOICES, autostart=False)
    app.state.service.load()
    response = speak(TestClient(app))
    assert response.status_code == 503
    assert response.json() == {"error": "loading"}


def test_error_bodies_never_echo_the_input():
    client, _ = ready_client()
    secret = "PHRASE-SECRETE-" + "x" * 300
    for overrides in ({}, {"voice": "nope"}, {"response_format": "wav"}):
        response = speak(client, input=secret, **overrides)
        assert response.status_code == 400
        assert "SECRETE" not in response.text


def test_only_one_synthesis_runs_at_a_time():
    models = {"fr": FakeModel(delay=0.05), "en": FakeModel(delay=0.05)}
    client, _ = ready_client(models)

    def call(index):
        voice = "estelle" if index % 2 == 0 else "alba"
        return speak(client, voice=voice, input=f"Phrase numéro {index}.").status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        statuses = list(pool.map(call, range(6)))
    assert statuses == [200] * 6
    assert len(models["fr"].calls) + len(models["en"].calls) == 6
    assert models["fr"].max_active == 1 and models["en"].max_active == 1


def test_synthesis_is_serialised_across_models():
    state = {"active": 0, "max": 0}
    guard = threading.Lock()

    class Counting(FakeModel):
        def synthesize(self, voice, text):
            with guard:
                state["active"] += 1
                state["max"] = max(state["max"], state["active"])
            try:
                return super().synthesize(voice, text)
            finally:
                with guard:
                    state["active"] -= 1

    client, _ = ready_client({"fr": Counting(delay=0.05), "en": Counting(delay=0.05)})

    def call(index):
        return speak(client, voice="estelle" if index % 2 == 0 else "alba").status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert list(pool.map(call, range(6))) == [200] * 6
    assert state["max"] == 1


def test_failed_synthesis_is_a_fixed_500():
    client, _ = ready_client({"fr": FakeModel(fail=True), "en": FakeModel()})
    response = speak(client, input="PHRASE-SECRETE")
    assert response.status_code == 500
    assert response.json() == {"error": "synthesis failed"}


def test_spoken_text_is_never_logged(caplog, capfd):
    caplog.set_level(logging.DEBUG)
    secret = "PHRASE-SECRETE-A-NE-JAMAIS-JOURNALISER"
    client, _ = ready_client({"fr": FakeModel(fail=True), "en": FakeModel()})
    speak(client, voice="alba", input=secret)
    speak(client, voice="estelle", input=secret)
    speak(client, voice="estelle", input=secret + "x" * 300)
    speak(client, voice="nope", input=secret)
    out, err = capfd.readouterr()
    assert caplog.records
    assert secret not in caplog.text
    assert secret not in out + err


def test_pocket_text_chunking_warnings_are_silenced():
    assert logging.getLogger("pocket_tts.models.text_chunking").level == logging.ERROR


def test_default_voices():
    assert parse_voices(server.DEFAULT_VOICES) == {"estelle": "fr", "alba": "en"}


def test_voices_are_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("POCKET_VOICES", "alba:en, jean:en")
    app = create_app(fake_loader({}), autostart=False)
    assert app.state.service.voices == {"alba": "en", "jean": "en"}
    assert app.state.service.languages == ["en"]


@pytest.mark.parametrize(
    "raw",
    ["", " , ", "estelle", "estelle:de", "estelle:", ":fr", "https://x/y.wav:fr", "../v:fr", "Alba:en"],
)
def test_invalid_voice_configuration_is_rejected(raw):
    with pytest.raises(ValueError):
        parse_voices(raw)
