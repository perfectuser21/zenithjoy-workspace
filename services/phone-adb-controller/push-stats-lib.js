// push-stats-lib.js —— push-videos.js / push-raw-comments.js 共用的"整批是否全军覆没"判断。
//
// 0929修复(DoD审计发现): 两个脚本此前对单条推送失败都只 console.log("FAIL",...) 记日志
// 继续，哪怕25条里22条失败也照样 exit 0，整批成败判定完全推给外部账本事后对数。
//
// 只判"全军覆没"这一档，不对部分失败也判非0退出：batch2.sh 用 `&&` 链式调用
// push-videos.js && push-raw-comments.js，对部分失败也判非0退出会连累后续步骤跟着
// 不跑（比如20条视频只有1条写失败，也会让评论落池整个跳过，放大损失）。只有"一条都没
// 成功"这种能推断出接口/凭据大概率坏了的极端情况，才值得让链路在这里停下来。
"use strict";

// pushAllFailed(created, dup, total) → boolean
//   created: 真正推送成功的条数
//   dup: 去重跳过的条数(不算失败,是正常的增量逻辑)
//   total: 本批输入总行数
function pushAllFailed(created, dup, total) {
  const attempted = total - dup;
  return attempted > 0 && created === 0;
}

module.exports = { pushAllFailed };
