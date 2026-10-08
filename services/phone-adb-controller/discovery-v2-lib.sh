#!/bin/zsh
# discovery-v2-lib.sh —— 发现改造(获客产量恢复 A 段,Brain 任务 9a8784b7)开关与公用小函数,discover-keyword.sh / harvest-keyword.sh 共用。
# v2 = 搜索按「最新」排序 + 翻屏取满 DISCOVERY_V2_CARDS(默认 20)张 + 点开之前先去重。名单外的号走原发现,行为不变。
# 开关: 环境变量 DISCOVERY_V2_PROFILES(逗号/空格分隔,设了就算空也以它为准,置空 = 全关)> 下面的默认名单。
# 默认名单写在本文件里而不是 config/: 运行时从冻结的发布目录跑,只带部署清单里的文件,改名单 = 走 PR 发新版本。
DV2_DEFAULT_PROFILES="jinoshengyuan-work"
discovery_v2_on(){
  local list="$DV2_DEFAULT_PROFILES"
  (( ${+DISCOVERY_V2_PROFILES} )) && list="$DISCOVERY_V2_PROFILES"
  local -a names; names=(${=${list//,/ }})
  (( ${names[(Ie)$1]} ))
}
# 标题归一: 去空白取前 30 字(库里存的是网格标题原文,网格偶有截断;前缀比对两边一致)
dv2_title_key(){ local t="${1//[[:space:]]/}"; print -r -- "${t[1,30]}"; }
