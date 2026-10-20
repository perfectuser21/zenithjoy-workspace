#!/bin/bash
M4_PAYLOAD_TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
m4_install_phase() {
  local host="$1" stage="$2" hash="$3" phase="$4" has_zsh="$5" result
  if ssh "$host" "python3 $stage/deployment-m4-payload.py install $stage/payload.tar $hash $phase $has_zsh"; then
    return 0
  else
    result=$?
    if [[ "$result" == 3 ]]; then FAILED=1; return 0; fi
    return "$result"
  fi
}
deploy_m4_payload() {
  local host="$1" local_stage stage hash has_zsh=0 _before _chk
  local_stage="$(mktemp -d)"
  hash="$(python3 "$M4_PAYLOAD_TOOL_DIR/deployment-m4-payload.py" pack "$D" "$local_stage/payload.tar" \
    --sh ${DEVICE_SH_FILES[@]+"${DEVICE_SH_FILES[@]}"} --node ${DEVICE_NODE_FILES[@]+"${DEVICE_NODE_FILES[@]}"} \
    --probe ${DEVICE_RPC_PROBE_FILES[@]+"${DEVICE_RPC_PROBE_FILES[@]}"} --plan ${DEVICE_PLAN_FILES[@]+"${DEVICE_PLAN_FILES[@]}"})"
  [[ "$hash" =~ ^[a-f0-9]{64}$ ]] || return 1
  stage="$(ssh "$host" 'mktemp -d /tmp/m4-payload-deploy.XXXXXX')"
  [[ "$stage" =~ ^/[A-Za-z0-9_./-]+$ && "$stage" != *'..'* ]] || return 1
  scp -q -p "$local_stage/payload.tar" "$M4_PAYLOAD_TOOL_DIR/deployment-m4-payload.py" "$host:$stage/"
  command -v zsh >/dev/null 2>&1 && has_zsh=1
  m4_install_phase "$host" "$stage" "$hash" before "$has_zsh"
  # Keep the original stream hash/reload barrier between its original SH neighbours.
  if [[ " ${DEVICE_SH_FILES[*]-} " == *' log-stream-push.sh '* ]]; then
    if [[ -s "$D/log-stream-push.sh" ]]; then
      _before="$(remote_md5 "$host" '~/bin-harvest/log-stream-push.sh')"
      push_atomic "$D/log-stream-push.sh" "$host" '~/bin-harvest' log-stream-push.sh x
      ssh "$host" 'chmod +x ~/bin-harvest/log-stream-push.sh'
      kickstart_if_changed "$host" com.zenithjoy.logstreampush "$_before" '~/bin-harvest/log-stream-push.sh'
      if command -v zsh >/dev/null 2>&1 && ssh "$host" 'zsh -n ~/bin-harvest/log-stream-push.sh' 2>/tmp/deploy-err-$$; then
        echo '    ✅ log-stream-push.sh'
      elif [[ -s /tmp/deploy-err-$$ ]]; then
        echo "    ❌ log-stream-push.sh 语法检查失败: $(head -3 /tmp/deploy-err-$$)"; FAILED=1
      else
        echo '    ✅ log-stream-push.sh (已复制,本机无zsh跳过语法检查)'
      fi
      rm -f /tmp/deploy-err-$$
    else
      echo '    ⚠️ 仓库里缺失: log-stream-push.sh (跳过)'
    fi
  fi
  m4_install_phase "$host" "$stage" "$hash" after "$has_zsh"
  ssh "$host" "rm -f $stage/deployment-m4-payload.py $stage/payload.tar; rmdir $stage"
  rm -rf "$local_stage"
}
