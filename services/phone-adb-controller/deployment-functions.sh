#!/bin/bash
# 原部署函数机械归位；调用顺序由 deploy.sh 保持。
push_atomic() {
  local src="$1" host="$2" rdir="$3" name="$4" mode="${5:-}" tmp
  tmp="$rdir/.$name.deploy-new"
  scp -q -p "$src" "$host:$tmp"
  if [[ "$mode" == "x" ]]; then
    ssh "$host" "chmod +x $tmp && mv -f $tmp $rdir/$name"
  elif [[ "$mode" == "evidence" ]]; then
    ssh "$host" "chmod 600 $tmp && mv -f $tmp $rdir/$name"
  else
    ssh "$host" "mv -f $tmp $rdir/$name"
  fi
}

# 固定源SQL仅作非执行验收附件；三份真实文件均由原collector读回。
deploy_release_evidence() {
  local mapping source destination host base expected actual target
  for mapping in "${RELEASE_EVIDENCE_FILES[@]}"; do
    source="${mapping%%=*}"; destination="${mapping#*=}"
    expected="$(python3 -c 'import json,sys; rows=[e for e in json.load(open(sys.argv[1]))["files"] if e["path"]==sys.argv[2] and e["deployed_path"]==sys.argv[3]]; exec("if len(rows)!=1:\n raise ValueError()"); print(rows[0]["content_sha256"])' "$DEPLOY_MANIFEST" "$source" "$destination")"
    for target in 'xian-m4|~/bin-harvest' 'mmv|~/bin-harvest' 'mmv|~/.openclaw/leadgen-scripts'; do
      host="${target%%|*}"; base="${target#*|}"
      ssh "$host" "python3 -c 'import pathlib,sys; home=pathlib.Path.home(); p=pathlib.Path(sys.argv[1]).expanduser(); parts=p.relative_to(home).parts; current=home; exec(\"for part in parts:\n current=current/part\n if current.is_symlink(): raise ValueError()\n current.mkdir(exist_ok=True)\")' $base/release-evidence"
      push_atomic "$REPO_ROOT/$source" "$host" "$base/release-evidence" "${destination##*/}" evidence
      actual="$(ssh "$host" "python3 -c 'import hashlib,pathlib,sys; p=pathlib.Path(sys.argv[1]).expanduser(); exec(\"if p.is_symlink():\n raise ValueError()\"); print(hashlib.sha256(p.read_bytes()).hexdigest())' $base/$destination")"
      [[ "$actual" == "$expected" ]] || { echo "SQL验收附件读回不符: $host/$destination" >&2; return 1; }
    done
  done
}

# Commander 入口整段封成函数：仅由完整已准入的双机事务在原位置调用。
commander_admission() {
  [[ -z "${WF_PHONE_TRANSACTION:-}" ]] || return 0 # check-child已核验原内核租约及双机日志。
  # 在途外壳保留原版本；整套文件和skills同步完成才发布新manifest。
  if ! python3 "$D/deployment-guard.py" admit
  then
    echo "  ❌ Commander仍有在途执行，拒绝覆盖其运行包"; FAILED=1; return
  fi
}

deploy_commander() {
  # 已由统一入口取得部署锁与admission；失败时.deploying保留。
  # Commander 入口(决策 7f842d12): 启动器落 mmv(openclaw CLI 在本机), skill 落 work-commander 工作区
  echo "=== [5/5] mmv Commander 入口(wf-launch/wf-status/wf-agent-run + 合同清单 + skills + AGENTS.md) ==="
  ssh mmv "mkdir -p ~/.openclaw/commander ~/openclaw-root/workspaces-root/clawd-work-commander/skills/workflow-commander"
  # wf-agent-run.sh / wf-agent-lib.py / workflow-contracts.json：codex_agent 形态共享外壳 runner 与 Commander 运行时合同清单（任务 c0fe7e30）
  for f in wf-launch.sh wf-status.sh wf-agent-run.sh wf-agent-lib.py wf-agent-handoff.py workflow-contracts.json wf-v2.py wf-v2-io.py wf-v2-phone.py wf-v2-shell.py wf-report.py; do
    if [[ ! -s "$D/commander/$f" ]]; then echo "  ⚠️ 仓库里缺失: commander/$f"; FAILED=1; continue; fi
    case "$f" in
      *.sh) push_atomic "$D/commander/$f" mmv "~/.openclaw/commander" "$f" x; _chk="bash -n ~/.openclaw/commander/$f";;
      *.py) push_atomic "$D/commander/$f" mmv "~/.openclaw/commander" "$f" x; _chk="python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' ~/.openclaw/commander/$f";;
      *.json) push_atomic "$D/commander/$f" mmv "~/.openclaw/commander" "$f"; _chk="python3 -c 'import json,sys; json.load(open(sys.argv[1]))' ~/.openclaw/commander/$f";;
    esac
    if ssh mmv "$_chk" 2>/tmp/deploy-err-$$; then
      echo "  ✅ commander/$f"
    else
      echo "  ❌ commander/$f 语法检查失败: $(head -3 /tmp/deploy-err-$$)"
      FAILED=1
    fi
    rm -f /tmp/deploy-err-$$
  done
  for contract in "$D"/commander/contracts/*.json; do
    [[ -f "$contract" ]] || continue
    ssh mmv "mkdir -p ~/.openclaw/commander/contracts"
    push_atomic "$contract" mmv "~/.openclaw/commander/contracts" "$(basename "$contract")"
  done
  # 通用 skill workflow-commander + 各 workflow 陪跑 skill wf-<能力>（决策 26df670a：合同 commander_skill 指向它们，Commander 按字段自加载）
  CMDR_SKILLS=()
  for sk in "$D"/commander/skills/*/SKILL.md; do
    [[ -s "$sk" ]] || continue
    _name="$(basename "$(dirname "$sk")")"
    ssh mmv "mkdir -p ~/openclaw-root/workspaces-root/clawd-work-commander/skills/$_name"
    push_atomic "$sk" mmv "~/openclaw-root/workspaces-root/clawd-work-commander/skills/$_name" SKILL.md
    ssh mmv "mkdir -p ~/.openclaw/commander/skills/$_name"
    push_atomic "$sk" mmv "~/.openclaw/commander/skills/$_name" SKILL.md
    CMDR_SKILLS+=("$_name")
    echo "  ✅ skills/$_name/SKILL.md"
  done
  if ! phone_transaction_tool mmv effects apply; then
    echo '  ❌ Commander原授权列CAS写入或读回失败'; FAILED=1
  fi
  # 0930 阶段 2(任务 81958796): work-commander 工作区 AGENTS.md 真身收进仓,改真身走 PR;工作区副本由这里覆盖(禁止手改)
  if [[ -s "$D/commander/AGENTS.md" ]]; then
    push_atomic "$D/commander/AGENTS.md" mmv "~/openclaw-root/workspaces-root/clawd-work-commander" AGENTS.md
    push_atomic "$D/commander/AGENTS.md" mmv "~/.openclaw/commander" AGENTS.md
    echo "  ✅ commander/AGENTS.md → work-commander 工作区"
  else
    echo "  ⚠️ 仓库里缺失: commander/AGENTS.md"; FAILED=1
  fi
  if [[ "$FAILED" == 0 ]]; then
    # 元数据文件仅含已验证release映射，不含token；未提供映射则v2不ready。
    local manifest_tmp
    manifest_tmp="$(mktemp -d)"
    python3 - "$D/commander" "${WF_COMMANDER_RELEASES_FILE:-}" "$manifest_tmp" <<'PYMANIFEST'
import importlib.util,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
spec=importlib.util.spec_from_file_location('commander_io',root/'wf-v2-io.py')
io=importlib.util.module_from_spec(spec);spec.loader.exec_module(io)
releases=json.load(open(sys.argv[2])) if sys.argv[2] else {}
files=io.components(root)
io.write(pathlib.Path(sys.argv[3])/'runtime-manifest.json',dict(protocol=io.PROTOCOL,files=files,runtime_snapshot_sha256=io.digest(files),releases=releases))
PYMANIFEST
    if [[ $? == 0 ]]; then
      push_atomic "$manifest_tmp/runtime-manifest.json" mmv "~/.openclaw/commander" runtime-manifest.json
      if ! ssh mmv "python3 ~/.openclaw/commander/wf-v2-io.py verify"; then FAILED=1; fi
      # 唯一聚合观测和所有本机视图ACK落地之前保留.deploying，禁止新run。
    else FAILED=1; fi
    rm -rf "$manifest_tmp"
  fi
}

source "${BASH_SOURCE[0]%/*}/deployment-m4-payload.sh"

# 只调用协调器已固定和逐字核验的工具，不把tx/environment当绕过锁的开关。
phone_transaction_tool() {
  local host="$1" name="$2" action="$3"
  node "$D/deployment-transport.mjs" "$(git rev-parse HEAD)" "$host" "deployment-$name.py" "$action" "$WF_PHONE_TRANSACTION" </dev/null
}
