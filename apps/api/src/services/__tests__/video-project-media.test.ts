import { describe, expect, it } from 'vitest';
import { planVideoSegments, validateVideoBoundaries } from '../video-project-media';
describe('video project scene segmentation', () => {
  it('retains detected scene cuts and covers every second with legal reference clips', () => {
    const segments = planVideoSegments(60, [8, 20, 45, 59.6]);
    expect(segments[0]).toEqual({start:0,end:8});
    expect(segments.at(-1)?.end).toBe(60);
    for (const [index, segment] of segments.entries()) {
      expect(segment.end-segment.start).toBeGreaterThanOrEqual(1);
      expect(segment.end-segment.start).toBeLessThan(15);
      if(index) expect(segment.start).toBe(segments[index-1].end);
    }
  });
  it('handles exact 15 second scenes and very short trailing scenes without losing time', () => {
    expect(planVideoSegments(15, [])).toEqual([{start:0,end:7.5},{start:7.5,end:15}]);
    const clips=planVideoSegments(30.4,[15,30]);
    expect(clips.at(-1)?.end).toBe(30.4);
    expect(clips.every(c=>c.end-c.start>=1 && c.end-c.start<15)).toBe(true);
  });
  it('rejects invalid duration and user cuts rather than silently changing explicit edits', () => {
    expect(()=>planVideoSegments(0.5,[])).toThrow();
    expect(()=>validateVideoBoundaries(60,[20,10])).toThrow();
    expect(()=>validateVideoBoundaries(60,[10,59.8])).toThrow();
    expect(()=>validateVideoBoundaries(60,[10,25,40,50])).toThrow();
    expect(validateVideoBoundaries(60,[12,24,36,48])).toHaveLength(5);
  });
});
