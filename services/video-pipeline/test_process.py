"""Unit tests for process.py build_keep_segments logic."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from process import build_keep_segments

def test_empty_segments():
    assert build_keep_segments([]) == []

def test_single_segment():
    segs = [{"start": 0.0, "end": 3.0, "text": "hello"}]
    result = build_keep_segments(segs)
    assert result == [(0.0, 3.0)]

def test_merge_close_segments():
    segs = [
        {"start": 0.0, "end": 2.0},
        {"start": 2.5, "end": 4.0},  # gap 0.5s < 1.5s threshold → merge
    ]
    result = build_keep_segments(segs)
    assert result == [(0.0, 4.0)]

def test_drop_long_silence():
    segs = [
        {"start": 0.0, "end": 2.0},
        {"start": 4.0, "end": 6.0},  # gap 2s > 1.5s threshold → split
    ]
    result = build_keep_segments(segs)
    assert result == [(0.0, 2.0), (4.0, 6.0)]

def test_custom_threshold():
    segs = [
        {"start": 0.0, "end": 1.0},
        {"start": 3.0, "end": 5.0},  # gap 2s
    ]
    # With threshold=3.0 → merge
    result = build_keep_segments(segs, min_silence_gap=3.0)
    assert result == [(0.0, 5.0)]
    # With threshold=1.0 → split
    result2 = build_keep_segments(segs, min_silence_gap=1.0)
    assert result2 == [(0.0, 1.0), (3.0, 5.0)]

if __name__ == "__main__":
    test_empty_segments()
    test_single_segment()
    test_merge_close_segments()
    test_drop_long_silence()
    test_custom_threshold()
    print("All tests passed.")
