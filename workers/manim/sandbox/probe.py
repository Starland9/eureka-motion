import json
import sys

from confine import confine


def main() -> int:
    confine(None, cpu_seconds=10, max_file_bytes=1 << 20)
    import av

    with av.open(sys.stdin.buffer, mode="r") as container:
        stream = container.streams.video[0]
        print(
            json.dumps(
                {
                    "codec": stream.codec_context.name,
                    "width": stream.codec_context.width,
                    "height": stream.codec_context.height,
                    "fps": float(stream.average_rate or 0),
                    "duration_s": container.duration / 1_000_000 if container.duration else 0.0,
                }
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
