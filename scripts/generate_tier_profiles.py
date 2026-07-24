"""Generate lightweight tier-board-only profile assets from SOOP channel IDs."""

from __future__ import annotations

import io
import json
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image, ImageOps, ImageSequence


ROOT = Path(__file__).resolve().parents[1]
CHANNELS_FILE = ROOT / "data" / "soop-channels.json"
OUTPUT_DIR = ROOT / "public" / "tier-profiles"
MANIFEST_FILE = OUTPUT_DIR / "manifest.json"
MAX_EDGE = 200
MAX_ANIMATION_FRAMES = 80
WORKERS = min(6, max(2, (os.cpu_count() or 4) // 2))
PRINT_LOCK = threading.Lock()


def request_bytes(url: str, attempts: int = 3) -> bytes:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 elo-kitten tier profiles",
                    "Referer": "https://ch.sooplive.co.kr/",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            )
            with urlopen(request, timeout=20) as response:
                data = response.read(20 * 1024 * 1024 + 1)
                if len(data) > 20 * 1024 * 1024:
                    raise ValueError("profile image exceeds 20 MB")
                return data
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(str(last_error or "download failed"))


def profile_url(broadcast_id: str) -> str:
    prefix = broadcast_id[:2]
    return (
        "https://profile.img.sooplive.co.kr/LOGO/"
        f"{prefix}/{broadcast_id}/{broadcast_id}.jpg"
    )


def fitted(frame: Image.Image, size: tuple[int, int]) -> Image.Image:
    return ImageOps.fit(
        frame.convert("RGBA"),
        size,
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.42),
    )


def atomic_save(image: Image.Image, path: Path, **options: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    image.save(temporary, "WEBP", **options)
    temporary.replace(path)


def generate_one(broadcast_id: str, names: list[str]) -> dict[str, object]:
    static_path = OUTPUT_DIR / f"{broadcast_id}-static.webp"
    animated_path = OUTPUT_DIR / f"{broadcast_id}-animated.webp"
    source = request_bytes(profile_url(broadcast_id))

    with Image.open(io.BytesIO(source)) as image:
        original_frames = int(getattr(image, "n_frames", 1))
        edge = min(MAX_EDGE, image.width, image.height)
        size = (edge, edge)
        first_frame = fitted(image.copy(), size)
        atomic_save(first_frame, static_path, quality=72, method=5, lossless=False)

        if original_frames <= 1:
            animated_path.write_bytes(static_path.read_bytes())
            output_frames = 1
        else:
            step = max(1, math.ceil(original_frames / MAX_ANIMATION_FRAMES))
            frames: list[Image.Image] = []
            durations: list[int] = []
            pending_duration = 0
            for index, frame in enumerate(ImageSequence.Iterator(image)):
                pending_duration += int(frame.info.get("duration", image.info.get("duration", 100)) or 100)
                if index % step and index + 1 < original_frames:
                    continue
                frames.append(fitted(frame, size))
                durations.append(pending_duration)
                pending_duration = 0

            temporary = animated_path.with_suffix(animated_path.suffix + ".tmp")
            frames[0].save(
                temporary,
                "WEBP",
                save_all=True,
                append_images=frames[1:],
                duration=durations,
                loop=int(image.info.get("loop", 0) or 0),
                quality=62,
                method=3,
                lossless=False,
                minimize_size=False,
            )
            temporary.replace(animated_path)
            output_frames = len(frames)

    return {
        "broadcastId": broadcast_id,
        "names": names,
        "source": profile_url(broadcast_id),
        "width": size[0],
        "height": size[1],
        "animated": original_frames > 1,
        "originalFrames": original_frames,
        "outputFrames": output_frames,
        "staticBytes": static_path.stat().st_size,
        "animatedBytes": animated_path.stat().st_size,
        "staticPath": f"/tier-profiles/{static_path.name}",
        "animatedPath": f"/tier-profiles/{animated_path.name}",
    }


def main() -> None:
    channels = json.loads(CHANNELS_FILE.read_text(encoding="utf-8"))
    names_by_id: dict[str, list[str]] = {}
    for name, value in channels.items():
        broadcast_id = str(value or "").strip()
        if not broadcast_id:
            continue
        names_by_id.setdefault(broadcast_id, []).append(name)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, object]] = []
    errors: list[dict[str, str]] = []
    total = len(names_by_id)

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {
            executor.submit(generate_one, broadcast_id, names): broadcast_id
            for broadcast_id, names in names_by_id.items()
        }
        for completed, future in enumerate(as_completed(futures), start=1):
            broadcast_id = futures[future]
            try:
                result = future.result()
                results.append(result)
                message = (
                    f"[{completed}/{total}] {broadcast_id}: "
                    f"{result['outputFrames']} frame(s), "
                    f"{result['animatedBytes']} bytes"
                )
            except Exception as error:
                errors.append({"broadcastId": broadcast_id, "error": str(error)})
                message = f"[{completed}/{total}] {broadcast_id}: ERROR {error}"
            with PRINT_LOCK:
                print(message, flush=True)

    results.sort(key=lambda item: str(item["broadcastId"]))
    manifest = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "channels": total,
        "generated": len(results),
        "errors": errors,
        "profiles": results,
    }
    MANIFEST_FILE.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "channels": total,
        "generated": len(results),
        "errors": len(errors),
        "staticBytes": sum(int(item["staticBytes"]) for item in results),
        "animatedBytes": sum(int(item["animatedBytes"]) for item in results),
        "animatedProfiles": sum(bool(item["animated"]) for item in results),
    }, ensure_ascii=False), flush=True)
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
