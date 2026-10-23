FROM manimcommunity/manim:v0.22.0@sha256:3c3ce944c09d6fa73de59fe1e7a95e334e193ae9c2275d65937054e675f87b03

USER root
# A new named volume takes the owner of /data/sandbox.
RUN install -d -m 0755 /opt/sandbox \
  && install -d -o 1000 -g 1000 -m 0770 /data/sandbox /data/sandbox/in /data/sandbox/out
COPY --chown=root:root --chmod=0444 sandbox/*.py /opt/sandbox/

USER 1000:1000
ENV SANDBOX_DIR=/data/sandbox
WORKDIR /opt/sandbox

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD ["python", "-I", "-c", "import os, sys, time; beat = open(os.environ['SANDBOX_DIR'] + '/out/.heartbeat').read(); sys.exit(0 if time.time() - int(beat) < 60 else 1)"]

ENTRYPOINT ["python", "-u", "-B", "-E", "-s", "/opt/sandbox/runner.py"]
