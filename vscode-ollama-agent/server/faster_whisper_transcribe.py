import argparse
import json
import sys


def load_faster_whisper():
    from faster_whisper import WhisperModel
    return WhisperModel


def main():
    parser = argparse.ArgumentParser(description="Bob Faster-Whisper transcription helper")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--model", default="base.en")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="en")
    parser.add_argument("--download-root", default="")
    parser.add_argument("--no-vad-filter", action="store_true")
    args = parser.parse_args()

    try:
        WhisperModel = load_faster_whisper()
        if args.check:
            print(json.dumps({"ok": True, "provider": "faster-whisper"}))
            return 0

        if not args.input:
            raise ValueError("--input is required")

        model_kwargs = {
            "device": args.device,
            "compute_type": args.compute_type,
        }
        if args.download_root:
            model_kwargs["download_root"] = args.download_root

        model = WhisperModel(args.model, **model_kwargs)
        segments, info = model.transcribe(
            args.input,
            language=args.language or None,
            vad_filter=not args.no_vad_filter,
            vad_parameters={
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 120,
            },
            condition_on_previous_text=False,
            beam_size=1,
        )
        segment_rows = []
        text_parts = []
        for segment in segments:
            text = (segment.text or "").strip()
            if text:
                text_parts.append(text)
            segment_rows.append({
                "start": segment.start,
                "end": segment.end,
                "text": text,
            })

        print(json.dumps({
            "ok": True,
            "provider": "faster-whisper",
            "language": getattr(info, "language", args.language),
            "duration": getattr(info, "duration", None),
            "text": " ".join(text_parts).strip(),
            "segments": segment_rows,
        }))
        return 0
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "provider": "faster-whisper",
            "error": str(exc),
        }), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
