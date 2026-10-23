#!/usr/bin/env bash
# Builds eureka-manim:test and runs the suite in a container isolated as the contract requires,
# then checks the image as deployed: runner as PID 1, HEALTHCHECK, exit code after docker stop.
# Usage: workers/manim/tests/run-tests.sh [unittest arguments, e.g. test_static_check]
set -euo pipefail

tests="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
manim="$(dirname "$tests")"
repo="$(cd "$manim/../.." && pwd)"
image="eureka-manim:test"
volume="eureka-manim-test-$$"
suite="eureka-manim-tests-$$"
deployed="eureka-manim-deployed-$$"
isolation=(
  --network none --read-only --tmpfs /tmp:size=256m
  --cap-drop ALL --security-opt no-new-privileges
  --cpus 2 --memory 2g --memory-swap 2g --pids-limit 256 --ipc none
)

cleanup() {
  docker rm -f "$suite" "$deployed" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build -q -t "$image" "$manim" >/dev/null
docker volume create "$volume" >/dev/null

if [ "$#" -eq 0 ]; then set -- discover -v -s /opt/manim/tests -t /opt/manim/tests; else set -- -v "$@"; fi
docker run --rm --name "$suite" "${isolation[@]}" \
  -v "$volume":/data/sandbox \
  -v "$manim":/opt/manim:ro \
  -v "$repo/packages/scene/src/tokens":/opt/tokens:ro \
  -w /opt/manim/tests -e HOME=/tmp -e PYTHONPATH=/opt/sandbox:/opt/manim/tests \
  --entrypoint python "$image" -B -m unittest "$@"

# The image as deployed, bare (runner as PID 1) and with the extra keys of the Compose file.
check_deployed() {
  docker run -d --name "$deployed" "${isolation[@]}" "$@" --health-interval 2s \
    -v "$volume":/data/sandbox "$image" >/dev/null
  local status=starting code label="${*:-bare}"
  for _ in $(seq 60); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$deployed")"
    [ "$status" = healthy ] && break
    sleep 1
  done
  docker stop -t 10 "$deployed" >/dev/null
  code="$(docker inspect -f '{{.State.ExitCode}}' "$deployed")"
  docker logs "$deployed" 2>&1 | sed "s/^/deployed image ($label): /"
  docker rm "$deployed" >/dev/null
  [ "$status" = healthy ] || { echo "deployed image ($label): health is $status" >&2; return 1; }
  [ "$code" = 0 ] || { echo "deployed image ($label): exit code $code after docker stop" >&2; return 1; }
  echo "deployed image ($label): healthy, exit code 0 after docker stop"
}
check_deployed
check_deployed --init --ulimit core=0
