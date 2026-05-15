#!/usr/bin/env python3
"""
Video pipeline processor — runs on xian-m4.
Usage: python3 process.py <job_dir>
  job_dir: absolute path, contains config.json + src/video.mp4 [src/logo.png]
Writes status.json with {status, progress, outputs} and outputs to out/
"""

import json
import os
import subprocess
import sys
import time

def write_status(job_dir, status, progress, error=None):
    data = {"status": status, "progress": progress}
    if error:
        data["error"] = error
    with open(os.path.join(job_dir, "status.json"), "w") as f:
        json.dump(data, f)

def run(cmd, **kwargs):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, **kwargs)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {cmd}\nSTDERR: {result.stderr}")
    return result.stdout.strip()

def transcribe(video_path, job_dir):
    import whisper
    model = whisper.load_model("base")
    result = model.transcribe(video_path, language="zh")
    segments_path = os.path.join(job_dir, "segments.json")
    with open(segments_path, "w") as f:
        json.dump(result["segments"], f, ensure_ascii=False, indent=2)
    return result["segments"]

def build_keep_segments(segments, min_silence_gap=1.5):
    """Merge voiced segments, drop gaps >min_silence_gap seconds."""
    if not segments:
        return []
    keeps = []
    cur_start = segments[0]["start"]
    cur_end   = segments[0]["end"]
    for seg in segments[1:]:
        if seg["start"] - cur_end <= min_silence_gap:
            cur_end = seg["end"]
        else:
            keeps.append((cur_start, cur_end))
            cur_start = seg["start"]
            cur_end   = seg["end"]
    keeps.append((cur_start, cur_end))
    return keeps

def rough_cut(video_path, keeps, job_dir):
    """Use FFmpeg concat to cut kept segments."""
    if not keeps:
        # No voiced segments — keep whole video
        return video_path

    concat_file = os.path.join(job_dir, "concat.txt")
    segments_dir = os.path.join(job_dir, "segments")
    os.makedirs(segments_dir, exist_ok=True)

    seg_paths = []
    for i, (start, end) in enumerate(keeps):
        duration = end - start
        seg_path = os.path.join(segments_dir, f"seg_{i:04d}.mp4")
        run(
            f'ffmpeg -y -ss {start:.3f} -t {duration:.3f} -i "{video_path}" '
            f'-c copy -avoid_negative_ts make_zero "{seg_path}"'
        )
        seg_paths.append(seg_path)

    with open(concat_file, "w") as f:
        for p in seg_paths:
            f.write(f"file '{p}'\n")

    rough_path = os.path.join(job_dir, "rough.mp4")
    run(
        f'ffmpeg -y -f concat -safe 0 -i "{concat_file}" '
        f'-c copy "{rough_path}"'
    )
    return rough_path

def export_formats(src_video, out_dir, logo_path=None):
    os.makedirs(out_dir, exist_ok=True)

    logo_filter = ""
    if logo_path and os.path.exists(logo_path):
        logo_filter = (
            f"[0:v][1:v]overlay=W-w-20:20[v];"
            f"[v]"
        )
        logo_input = f'-i "{logo_path}"'
    else:
        logo_input = ""

    # 9:16 vertical (1080×1920)
    out_916 = os.path.join(out_dir, "9_16.mp4")
    if logo_input:
        vf = f"{logo_filter}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
    else:
        vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
    run(
        f'ffmpeg -y -i "{src_video}" {logo_input} '
        f'-vf "{vf}" -c:v libx264 -crf 23 -preset fast -c:a aac '
        f'"{out_916}"'
    )

    # 16:9 horizontal (1920×1080)
    out_169 = os.path.join(out_dir, "16_9.mp4")
    if logo_input:
        vf = f"{logo_filter}scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2"
    else:
        vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2"
    run(
        f'ffmpeg -y -i "{src_video}" {logo_input} '
        f'-vf "{vf}" -c:v libx264 -crf 23 -preset fast -c:a aac '
        f'"{out_169}"'
    )

    return out_916, out_169

def main():
    if len(sys.argv) < 2:
        print("Usage: process.py <job_dir>", file=sys.stderr)
        sys.exit(1)

    job_dir = sys.argv[1]
    config_path = os.path.join(job_dir, "config.json")

    with open(config_path) as f:
        config = json.load(f)

    video_path = os.path.join(job_dir, "src", "video.mp4")
    logo_path  = os.path.join(job_dir, "src", "logo.png")
    out_dir    = os.path.join(job_dir, "out")

    try:
        write_status(job_dir, "in_progress", 10)

        # Step 1: Whisper transcription
        print("[process] Transcribing with Whisper...")
        segments = transcribe(video_path, job_dir)
        write_status(job_dir, "in_progress", 40)

        # Step 2: Build keep segments
        keeps = build_keep_segments(segments, min_silence_gap=config.get("min_silence_gap", 1.5))
        print(f"[process] {len(keeps)} keep segments")
        write_status(job_dir, "in_progress", 50)

        # Step 3: Rough cut
        print("[process] Rough cutting...")
        rough_path = rough_cut(video_path, keeps, job_dir)
        write_status(job_dir, "in_progress", 70)

        # Step 4: Export formats
        print("[process] Exporting 9:16 and 16:9...")
        logo = logo_path if os.path.exists(logo_path) else None
        out_916, out_169 = export_formats(rough_path, out_dir, logo)
        write_status(job_dir, "in_progress", 95)

        # Step 5: Done
        status_data = {
            "status": "completed",
            "progress": 100,
            "outputs": {
                "9_16": out_916,
                "16_9": out_169,
            }
        }
        with open(os.path.join(job_dir, "status.json"), "w") as f:
            json.dump(status_data, f)
        print("[process] Done.")

    except Exception as e:
        print(f"[process] ERROR: {e}", file=sys.stderr)
        write_status(job_dir, "failed", 0, error=str(e))
        sys.exit(1)

if __name__ == "__main__":
    main()
