// 同一偏移应用于所有Node子进程及shell；时间仍推进，预算/TERM案例保持真实时间。
import {appendFileSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
export function alignFixtureClock(f,epochMs=Date.parse('2026-10-02T10:40:00Z')) {
 const offset=epochMs-Date.now();
 f.env.FIXTURE_CLOCK_OFFSET_MS=String(offset);
 appendFileSync(join(f.home,'http-fixture.cjs'), `\nconst fixtureRealNow=Date.now.bind(Date);\nDate.now=()=>fixtureRealNow()+Number(process.env.FIXTURE_CLOCK_OFFSET_MS);\n`);
 const date=join(f.home,'.local/bin/date');
 writeFileSync(date, '#!/bin/sh\nif [ "$1" = +%s ]; then\n real=$(/bin/date +%s)\n echo $((real + FIXTURE_CLOCK_OFFSET_MS / 1000))\n exit 0\nfi\nexec /bin/date "$@"\n');
 chmodSync(date,0o755);
}
