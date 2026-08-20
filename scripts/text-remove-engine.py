#!/usr/bin/env python3
"""Blur hardcoded subtitle glyphs inside a user-selected search region.

The caller supplies a broad region where the old subtitle may appear.  For each
frame we find the densest neutral/bright text band in that region, expand the
mask over the glyphs and their outline, then apply a strong local blur through
the tight bounding box of the detected line.  Covering the gaps between glyphs
prevents a readable text-shaped silhouette while avoiding blur across the whole
user-selected region.  There is no background reconstruction.  Frames are
streamed between FFmpeg and OpenCV so the pipeline does not write hundreds of
temporary PNG files, and the input audio stream is retained.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import cv2
import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass


def emit(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


def run_command(args: list[str]) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)


def parse_rate(value: str) -> float:
    value = value.strip()
    if "/" in value:
        numerator, denominator = value.split("/", 1)
        try:
            return float(numerator) / float(denominator)
        except (ValueError, ZeroDivisionError):
            return 30.0
    try:
        return float(value)
    except ValueError:
        return 30.0


def probe_video(ffprobe: str, video: str) -> tuple[float, int, int, int]:
    result = run_command([
        ffprobe,
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate,nb_frames:format=duration",
        "-of", "json",
        video,
    ])
    if result.returncode != 0:
        return 30.0, 0, 0, 0
    try:
        payload = json.loads(result.stdout.decode("utf-8", "replace"))
        stream = (payload.get("streams") or [{}])[0]
        width = int(stream.get("width") or 0)
        height = int(stream.get("height") or 0)
    except (ValueError, TypeError, json.JSONDecodeError):
        return 30.0, 0, 0, 0
    fps = 30.0
    for rate in (stream.get("avg_frame_rate"), stream.get("r_frame_rate")):
        if not isinstance(rate, str):
            continue
        parsed = parse_rate(rate)
        if parsed > 0:
            fps = parsed
            break
    try:
        frame_count = int(stream.get("nb_frames") or 0)
    except (TypeError, ValueError):
        frame_count = 0
    if frame_count <= 0:
        try:
            duration = float((payload.get("format") or {}).get("duration") or 0)
            frame_count = max(0, int(round(duration * fps)))
        except (TypeError, ValueError):
            frame_count = 0
    return fps, width, height, frame_count


def keep_component(component: np.ndarray, stats: np.ndarray) -> bool:
    x, y, width, height, area = [int(value) for value in stats[component]]
    del x, y
    # Subtitle glyphs are small connected pieces.  Very large regions are
    # background areas and are deliberately excluded from the text mask.
    return 8 <= area <= 5000 and 2 <= width <= 180 and 4 <= height <= 140


def _text_components(binary: np.ndarray) -> np.ndarray:
    """Keep only glyph-sized components from a contrast mask."""
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    output = np.zeros_like(binary)
    image_height, image_width = binary.shape[:2]
    for component in range(1, count):
        x, y, component_width, component_height, area = [int(value) for value in stats[component]]
        # Morphological top-hat/black-hat uses a border value that can create
        # a long artificial component at the crop edge.  It is never a valid
        # subtitle glyph and was a direct source of blur outside the text.
        if x <= 1 or y <= 1 or x + component_width >= image_width - 1 or y + component_height >= image_height - 1:
            continue
        box_area = max(1, component_width * component_height)
        fill = area / box_area
        # Stroke-like components are small, but a full bright wall or a large
        # scene edge is not.  The fill guard also removes most flat highlights
        # that previously became a false subtitle band.
        if (
            6 <= area <= 1800
            and 1 <= component_width <= 140
            and 3 <= component_height <= 90
            and 0.015 <= fill <= 0.82
        ):
            output[labels == component] = 255
    return output


def make_text_mask(frame: np.ndarray, x0: int, x1: int, y0: int, y1: int, margin: int) -> np.ndarray:
    height, width = frame.shape[:2]
    x0 = max(0, min(width - 1, x0))
    x1 = max(x0 + 1, min(width, x1))
    y0 = max(0, min(height - 1, y0))
    y1 = max(y0 + 1, min(height, y1))
    crop = frame[y0:y1, x0:x1]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    # Subtitles are commonly white, but coloured and dark outlined glyphs are
    # also frequent.  Combine neutral-bright pixels with local top-hat/
    # black-hat contrast so detection does not depend on one subtitle colour.
    bright = cv2.inRange(
        hsv,
        np.array([0, 0, 132], dtype=np.uint8),
        np.array([180, 210, 255], dtype=np.uint8),
    )
    structure_width = max(15, min(61, (crop.shape[1] // 7) | 1))
    structure_height = max(3, min(11, margin * 2 + 1))
    structure = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (structure_width, structure_height),
    )
    white_hat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, structure)
    black_hat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, structure)
    text_components = cv2.bitwise_or(
        _text_components(bright),
        cv2.bitwise_or(
            _text_components(cv2.inRange(white_hat, 18, 255)),
            _text_components(cv2.inRange(black_hat, 18, 255)),
        ),
    )

    # Locate the strongest horizontal text band from the filtered projection.
    # This keeps the mask useful when the selected rectangle is much taller
    # than the subtitle itself and avoids selecting bright scene details.
    projection = (text_components > 0).sum(axis=1).astype(np.float32)
    minimum_peak = max(8.0, crop.shape[1] * 0.004)
    if projection.size == 0 or float(projection.max()) < minimum_peak:
        return np.zeros((height, width), dtype=np.uint8)
    kernel = np.ones(9, dtype=np.float32) / 9.0
    smooth = np.convolve(projection, kernel, mode="same")
    peak = int(np.argmax(smooth))
    peak_value = float(smooth[peak])
    threshold = max(minimum_peak * 0.65, peak_value * 0.22)
    top = peak
    bottom = peak
    while top > 0 and smooth[top - 1] >= threshold:
        top -= 1
    while bottom + 1 < len(smooth) and smooth[bottom + 1] >= threshold:
        bottom += 1
    top = max(0, top - max(2, margin // 2))
    bottom = min(crop.shape[0] - 1, bottom + max(2, margin // 2))

    band = np.zeros_like(bright)
    band[top:bottom + 1, :] = 255
    # Keep the mask glyph-shaped.  The old implementation repeatedly closed
    # and dilated the whole line; neighbouring CJK glyphs then merged into one
    # long opaque strip and changed the background around the subtitle.  Start
    # from each bright glyph and add only edge pixels that are directly beside
    # that glyph (normally its dark outline/shadow).
    glyphs = cv2.bitwise_and(text_components, band)
    # Add only genuinely dark outline/shadow pixels close to a bright glyph.
    # A plain 10 px dilation removes the outline too, but also fills the gaps
    # between adjacent CJK characters and recreates the unwanted long strip.
    outline_radius = max(3, min(7, int(round(margin * 0.75))))
    outline_size = outline_radius * 2 + 1
    near_glyph = cv2.dilate(
        glyphs,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (outline_size, outline_size)),
        iterations=1,
    )
    dark_outline = cv2.bitwise_and(cv2.inRange(gray, 0, 105), near_glyph)
    filtered = cv2.bitwise_or(glyphs, dark_outline)

    # One pixel catches anti-aliased boundary pixels while keeping the mask
    # shaped like the actual foreground strokes.
    filtered = cv2.dilate(filtered, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=1)

    # A real subtitle line forms one or a few dense glyph groups. Scene
    # texture (water ripples, fur, reflections) produces many isolated little
    # components spread across the band. Reject that scattered pattern before
    # it can become a wide false blur box.
    component_count, _, component_stats, _ = cv2.connectedComponentsWithStats(filtered, 8)
    if component_count > 13 and component_count > 1:
        areas = component_stats[1:, 4].astype(np.float32)
        total_area = float(areas.sum())
        largest_fraction = float(areas.max() / max(1.0, total_area))
        if largest_fraction < 0.68:
            return np.zeros((height, width), dtype=np.uint8)

    mask = np.zeros((height, width), dtype=np.uint8)
    mask[y0:y1, x0:x1] = filtered
    return mask


def make_fast_text_mask(
    frame: np.ndarray,
    region: tuple[int, int, int, int],
    margin: int,
    max_dimension: int = 640,
) -> np.ndarray:
    """Detect text on a reduced crop, then scale the mask back to the frame.

    Detection only needs glyph geometry. Running HSV/morphology at the full
    1080p/4K crop wastes most of the work while the final cover is still
    applied at full resolution.
    """
    height, width = frame.shape[:2]
    x0, x1, y0, y1 = region
    x0 = max(0, min(width - 1, x0))
    x1 = max(x0 + 1, min(width, x1))
    y0 = max(0, min(height - 1, y0))
    y1 = max(y0 + 1, min(height, y1))
    crop = frame[y0:y1, x0:x1]
    crop_height, crop_width = crop.shape[:2]
    scale = min(1.0, max_dimension / max(crop_width, crop_height))
    if scale < 0.999:
        small_width = max(1, int(round(crop_width * scale)))
        small_height = max(1, int(round(crop_height * scale)))
        small_crop = cv2.resize(crop, (small_width, small_height), interpolation=cv2.INTER_AREA)
        small_margin = max(2, int(round(margin * scale)))
        small_mask = make_text_mask(
            small_crop,
            0,
            small_width,
            0,
            small_height,
            small_margin,
        )
        filtered = cv2.resize(
            small_mask,
            (crop_width, crop_height),
            interpolation=cv2.INTER_NEAREST,
        )
    else:
        filtered = make_text_mask(crop, 0, crop_width, 0, crop_height, margin)

    mask = np.zeros((height, width), dtype=np.uint8)
    mask[y0:y1, x0:x1] = filtered
    return mask


def blur_text_frame(
    frame: np.ndarray,
    mask: np.ndarray,
    radius: float,
    cover_box: tuple[int, int, int, int] | None = None,
) -> np.ndarray:
    if not np.any(mask):
        return frame
    ys, xs = np.where(mask > 0)
    blur_size = max(41, min(91, int(round(radius * 9))))
    if blur_size % 2 == 0:
        blur_size += 1
    if cover_box is None:
        box_x0 = int(xs.min())
        box_x1 = int(xs.max()) + 1
        box_y0 = int(ys.min())
        box_y1 = int(ys.max()) + 1
    else:
        box_x0, box_x1, box_y0, box_y1 = cover_box
    cover_pad = max(4, int(round(radius * 0.7)))
    context_pad = max(6, int(round(radius * 1.4)))
    box_x0 = max(0, box_x0 - cover_pad)
    box_x1 = min(frame.shape[1], box_x1 + cover_pad)
    box_y0 = max(0, box_y0 - cover_pad)
    box_y1 = min(frame.shape[0], box_y1 + cover_pad)
    x0 = max(0, box_x0 - context_pad)
    x1 = min(frame.shape[1], box_x1 + context_pad)
    y0 = max(0, box_y0 - context_pad)
    y1 = min(frame.shape[0], box_y1 + context_pad)
    roi = frame[y0:y1, x0:x1]

    # Blur a neighbourhood strongly enough that the original glyph is no
    # longer readable.  A glyph-shaped composite still exposes the silhouette
    # of every character, so cover the tight detected line box including the
    # small gaps between glyphs.  This box is derived from the text mask and is
    # much smaller than the broad search rectangle selected by the user.  The
    # old implementation blurred a very large padded ROI and let that padding
    # become visible on high-contrast backgrounds.
    blurred = cv2.blur(roi, (blur_size, blur_size))
    cover_mask = np.zeros((roi.shape[0], roi.shape[1]), dtype=np.uint8)
    local_x0 = max(0, box_x0 - x0)
    local_x1 = min(roi.shape[1], box_x1 - x0)
    local_y0 = max(0, box_y0 - y0)
    local_y1 = min(roi.shape[0], box_y1 - y0)
    cover_mask[local_y0:local_y1, local_x0:local_x1] = 255
    # Opaque in the text box, feathered by only a couple of pixels at the
    # edge.  This guarantees that no original glyph stroke remains readable
    # while keeping nearby, text-free pixels unchanged.
    alpha = cv2.GaussianBlur(cover_mask, (0, 0), 1.0).astype(np.float32) / 255.0
    alpha = np.clip(alpha * 1.35, 0.0, 1.0)[..., None]
    blended = (
        roi.astype(np.float32) * (1.0 - alpha)
        + blurred.astype(np.float32) * alpha
    ).astype(np.uint8)
    output = frame.copy()
    output[y0:y1, x0:x1] = blended
    return output


def mask_box(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(mask > 0)
    if len(xs) == 0 or len(ys) == 0:
        return None
    return int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1


def perceptual_hash(image: np.ndarray) -> np.ndarray:
    """Return a small DCT hash for cheap frame-change detection.

    The hash is deliberately calculated from the already-downscaled probe,
    not the full frame. It is used only to decide whether an expensive text
    mask refresh is needed; the mask itself is never approximated by this
    hash.
    """
    if image.ndim != 2:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(image, (32, 32), interpolation=cv2.INTER_AREA)
    low_frequency = cv2.dct(small.astype(np.float32))[:8, :8]
    threshold = float(np.median(low_frequency[1:, :]))
    return low_frequency > threshold


def perceptual_distance(previous: np.ndarray | None, current: np.ndarray) -> int:
    if previous is None or previous.shape != current.shape:
        return 64
    return int(np.count_nonzero(previous != current))


def boxes_close(
    previous: tuple[int, int, int, int],
    current: tuple[int, int, int, int],
) -> bool:
    px0, px1, py0, py1 = previous
    cx0, cx1, cy0, cy1 = current
    previous_width = max(1, px1 - px0)
    current_width = max(1, cx1 - cx0)
    previous_height = max(1, py1 - py0)
    current_height = max(1, cy1 - cy0)
    previous_center = ((px0 + px1) / 2, (py0 + py1) / 2)
    current_center = ((cx0 + cx1) / 2, (cy0 + cy1) / 2)
    center_y_limit = max(12, int(max(previous_height, current_height) * 1.4))
    center_x_limit = max(24, int(max(previous_width, current_width) * 0.35))
    return (
        abs(previous_center[0] - current_center[0]) <= center_x_limit
        and abs(previous_center[1] - current_center[1]) <= center_y_limit
        and 0.45 <= current_width / previous_width <= 2.2
        and 0.45 <= current_height / previous_height <= 2.2
    )


def smooth_box(
    previous: tuple[int, int, int, int],
    current: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    # Dampen one-frame detector jitter without expanding the cover into the
    # rest of the selected region.
    return tuple(
        int(round(old * 0.72 + new * 0.28))
        for old, new in zip(previous, current)
    )  # type: ignore[return-value]


def stream_blur_once(
    ffmpeg: str,
    input_video: str,
    output_video: str,
    fps: float,
    width: int,
    height: int,
    expected_frames: int,
    region: tuple[int, int, int, int],
    margin: int,
    radius: float,
    mask_policy: str,
    encoder: list[str],
    debug_mask: str,
) -> tuple[int, str, int]:
    decoder_args = [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "error",
        "-i", input_video,
        "-map", "0:v:0",
        "-an", "-sn", "-dn",
        "-pix_fmt", "bgr24",
        "-f", "rawvideo",
        "pipe:1",
    ]
    encode_args = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-video_size", f"{width}x{height}",
        "-framerate", f"{fps:.12f}",
        "-i", "pipe:0",
        "-i", input_video,
        "-map", "0:v:0",
        "-map", "1:a?",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        *encoder,
        "-c:a", "copy",
        "-shortest",
        output_video,
    ]
    decoder = subprocess.Popen(decoder_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    video_encoder = subprocess.Popen(encode_args, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    frame_bytes = width * height * 3
    frame_count = 0
    error = ""
    region_x0 = max(0, min(width - 1, region[0]))
    region_x1 = max(region_x0 + 1, min(width, region[1]))
    region_y0 = max(0, min(height - 1, region[2]))
    region_y1 = max(region_y0 + 1, min(height, region[3]))
    region = (region_x0, region_x1, region_y0, region_y1)
    stable_box: tuple[int, int, int, int] | None = None
    stable_hits = 0
    missed_frames = 0
    active_mask = np.zeros((height, width), dtype=np.uint8)
    probe_frame: np.ndarray | None = None
    # Start conservatively, then widen the interval while the same text mask
    # remains valid. A pHash/scene probe brings detection back immediately
    # when the crop changes, so this is safer than a fixed N-frame skip.
    detection_interval = 2
    last_detect_hash: np.ndarray | None = None
    locked_mask: np.ndarray | None = None
    locked_box: tuple[int, int, int, int] | None = None
    debug_written = False
    last_progress = -1
    try:
        while True:
            data = decoder.stdout.read(frame_bytes) if decoder.stdout else b""
            if not data:
                break
            while len(data) < frame_bytes and decoder.stdout:
                chunk = decoder.stdout.read(frame_bytes - len(data))
                if not chunk:
                    break
                data += chunk
            if len(data) != frame_bytes:
                error = "FFmpeg trả về frame không đầy đủ."
                break
            frame = np.frombuffer(data, dtype=np.uint8).reshape((height, width, 3))
            # Detection is the expensive part. Reuse the last stable mask on
            # the in-between frame; a small scene probe forces an immediate
            # refresh on hard cuts without paying full OpenCV cost every time.
            x0, x1, y0, y1 = region
            probe_crop = frame[y0:y1, x0:x1]
            probe = cv2.resize(
                cv2.cvtColor(probe_crop, cv2.COLOR_BGR2GRAY),
                (48, 48),
                interpolation=cv2.INTER_AREA,
            )
            scene_changed = (
                probe_frame is not None
                and float(cv2.absdiff(probe, probe_frame).mean()) > 42.0
            )
            current_hash = perceptual_hash(probe)
            hash_changed = (
                last_detect_hash is not None
                and perceptual_distance(last_detect_hash, current_hash) > 4
            )
            probe_frame = probe
            if mask_policy == 'locked' and locked_mask is not None:
                should_detect = False
                active_mask = locked_mask
                active_box = locked_box
            else:
                should_detect = (
                    frame_count == 0
                    or stable_box is None
                    or frame_count % detection_interval == 0
                    or scene_changed
                    or hash_changed
                )
                active_box = stable_box
            if should_detect:
                mask = make_fast_text_mask(frame, region, margin)
                detected_box = mask_box(mask)
                if detected_box is None:
                    missed_frames += 1
                    # Do not keep blurring an old location after the text has
                    # disappeared. This prevents a persistent smear in an
                    # otherwise text-free part of the video.
                    if missed_frames >= 2:
                        stable_box = None
                        stable_hits = 0
                        detection_interval = 2
                    active_mask = np.zeros_like(mask)
                    active_box = None
                elif stable_box is None or not boxes_close(stable_box, detected_box):
                    stable_box = detected_box
                    stable_hits = 1
                    missed_frames = 0
                    detection_interval = 2
                    # Blur the first detected frame immediately. Temporal
                    # tracking smooths later jitter but never delays coverage.
                    active_mask = mask
                    active_box = stable_box
                else:
                    stable_box = smooth_box(stable_box, detected_box)
                    stable_hits = min(3, stable_hits + 1)
                    missed_frames = 0
                    # The mask is stable: skip more detector passes until the
                    # cheap pHash/scene probe observes a meaningful change.
                    detection_interval = min(8, 2 + max(0, stable_hits - 1) * 2)
                    active_mask = mask
                    active_box = stable_box
                last_detect_hash = current_hash
                if mask_policy == 'locked' and detected_box is not None and locked_mask is None:
                    locked_mask = mask.copy()
                    locked_box = detected_box
                    active_mask = locked_mask
                    active_box = locked_box

            if debug_mask and not debug_written and active_box is not None:
                cv2.imwrite(debug_mask, active_mask)
                debug_written = True
            cleaned = blur_text_frame(frame, active_mask, radius, active_box)
            if not video_encoder.stdin:
                error = "Không mở được luồng mã hóa FFmpeg."
                break
            video_encoder.stdin.write(cleaned.tobytes())
            frame_count += 1
            denominator = expected_frames if expected_frames > 0 else max(frame_count, 1)
            # Progress is UI feedback, not a per-frame log channel. Emitting
            # every frame adds IPC/JSON overhead on long 1080p/4K jobs.
            progress = min(80, (int(frame_count / denominator * 80) // 5) * 5)
            if progress != last_progress:
                emit({
                    "type": "progress",
                    "percent": progress,
                    "text": "Đang làm mờ chữ trong khung…",
                })
                last_progress = progress
    except (BrokenPipeError, OSError) as stream_error:
        error = str(stream_error)
    finally:
        if video_encoder.stdin:
            try:
                video_encoder.stdin.close()
            except OSError:
                pass
        if decoder.stdout:
            decoder.stdout.close()
        decoder.wait()
        video_encoder.wait()

    decoder_error = decoder.stderr.read().decode("utf-8", "replace")[-2000:] if decoder.stderr else ""
    encoder_error = video_encoder.stderr.read().decode("utf-8", "replace")[-2000:] if video_encoder.stderr else ""
    if (
        not error
        and frame_count > 0
        and decoder.returncode == 0
        and video_encoder.returncode == 0
        and os.path.exists(output_video)
        and os.path.getsize(output_video) > 4096
    ):
        return 0, "", frame_count
    error = error or encoder_error or decoder_error or "FFmpeg không xử lý được video."
    try:
        if decoder.poll() is None:
            decoder.terminate()
        if video_encoder.poll() is None:
            video_encoder.terminate()
    except OSError:
        pass
    try:
        try:
            os.remove(output_video)
        except FileNotFoundError:
            pass
    except OSError:
        pass
    return 1, error, frame_count


def blur_video(
    ffmpeg: str,
    input_video: str,
    output_video: str,
    fps: float,
    width: int,
    height: int,
    expected_frames: int,
    region: tuple[int, int, int, int],
    margin: int,
    radius: float,
    mask_policy: str,
    prefer_gpu: bool,
    debug_mask: str,
) -> tuple[int, str, int]:
    encoders = []
    if prefer_gpu:
        encoders.append(["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23"])
    encoders.append(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"])
    last_error = ""
    last_frames = 0
    for encoder in encoders:
        code, error, frames = stream_blur_once(
            ffmpeg,
            input_video,
            output_video,
            fps,
            width,
            height,
            expected_frames,
            region,
            margin,
            radius,
            mask_policy,
            encoder,
            debug_mask,
        )
        if code == 0:
            return 0, "", frames
        last_error = error
        last_frames = frames
    return 1, last_error, last_frames


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--ffprobe", required=True)
    parser.add_argument("--x0", type=int, required=True)
    parser.add_argument("--x1", type=int, required=True)
    parser.add_argument("--y0", type=int, required=True)
    parser.add_argument("--y1", type=int, required=True)
    parser.add_argument("--margin", type=int, default=8)
    parser.add_argument("--radius", type=float, default=8.0)
    parser.add_argument("--mask-policy", choices=("adaptive", "locked"), default="adaptive")
    parser.add_argument("--prefer-gpu", action="store_true")
    parser.add_argument("--debug-mask", default="")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        emit({"type": "error", "message": "Không tìm thấy video nguồn."})
        return 1

    fps, width, height, expected_frames = probe_video(args.ffprobe, args.input)
    if width <= 0 or height <= 0:
        emit({"type": "error", "message": "Không đọc được kích thước video nguồn."})
        return 1
    emit({
        "type": "status",
        "message": f"Đang làm mờ chữ theo mask ({expected_frames or '?'} frame)…",
    })
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    code, error, frames = blur_video(
        args.ffmpeg,
        args.input,
        args.output,
        fps,
        width,
        height,
        expected_frames,
        (args.x0, args.x1, args.y0, args.y1),
        args.margin,
        max(1.0, min(15.0, args.radius)),
        args.mask_policy,
        args.prefer_gpu,
        args.debug_mask,
    )
    if code != 0:
        emit({"type": "error", "message": f"FFmpeg không mã hóa được video đã làm mờ chữ: {error}"})
        return code
    emit({"type": "progress", "percent": 100, "text": "Đã làm mờ chữ trong khung."})
    emit({"type": "done", "output": args.output, "fps": fps, "frames": frames})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # keep JSON protocol readable by the main process
        emit({"type": "error", "message": str(error)[:1000]})
        raise
