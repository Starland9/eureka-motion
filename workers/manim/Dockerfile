FROM manimcommunity/manim:v0.22.0

COPY --chown=manimuser:manimuser sandbox/ /opt/sandbox/

USER manimuser
WORKDIR /opt/sandbox
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

ENTRYPOINT ["python", "/opt/sandbox/runner.py"]
