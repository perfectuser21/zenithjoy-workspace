#!/usr/bin/env bash
# trim_json_stdin — 去除 JSON 文本首尾空白，不破坏引号/内容。
#
# 用于替代 `| xargs` 做 trim：xargs（不带参数）执行标准 shell-word-splitting +
# quote-removal 语义，会把 JSON 里的双引号全部剥掉——2026-08-04
# line02-android-collect-realmachine-smoke.sh 真机 Seg3 质量闸复现：
# echo '[{"nickname":"张三"}]' | tr -d '\n' | xargs 输出 [{nickname:张三}]，
# 后续 JSON.parse 必然抛异常。sed 只做首尾空白裁剪，不触碰内容。
trim_json_stdin() {
  sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}
