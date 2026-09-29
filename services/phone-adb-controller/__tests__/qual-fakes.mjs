// 先判后采(任务 8bb3af55)之后 harvest-keyword.sh 每个视频开评论区之前要经 ssh 调 mmv 的 qualify-video.js,
// 只有回话 verdict=matched 才采评论。不以判定为测试对象的 harvest-keyword 整链路测试共用这份假 ssh/scp:
// discover 回 pending(没判过)、judge 回 matched、collected 回 updated=1,其它 ssh(fetch-seen-videos)静默 exit 0。
export const FAKE_SSH_QUAL = `#!/bin/sh
case "$*" in
  *"qualify-video.js discover"*) printf 'QUAL_DISCOVER {"status":"pending","has_transcript":false}\\n';;
  *"qualify-video.js judge"*) printf 'QUAL_RESULT {"verdict":"matched","reason":"r","kind":"judged"}\\n';;
  *"qualify-video.js collected"*) printf 'QUAL_COLLECTED {"updated":1}\\n';;
esac
exit 0`;
export const FAKE_SCP = `#!/bin/sh
exit 0`;
