#!/bin/bash
# 假 curl：模拟 Brain /api/brain/device-locks/{acquire,release}（派发总闸D，任务 dd7767b8）。
# 状态目录 $FAKE_BRAIN_DIR：
#   down              存在 → 模拟连不上（curl 退出码 7）
#   busy-<serial>     存在 → acquire 返回被占，内容 = 持有者
#   unknown-<serial>  存在 → acquire 返回 404 未注册设备
#   held-<serial>     acquire 成功后写入 owner；release 只放本 owner
# 每次调用追加一行到 $FAKE_BRAIN_DIR/calls.log：<acquire|release> <serial> <owner> <ttl> <鉴权头>
D="${FAKE_BRAIN_DIR:?}"
url="" data="" auth=""
while [ $# -gt 0 ]; do
  case "$1" in
    --data-binary|-d|--data) data="$2"; shift 2;;
    -H) case "$2" in Authorization:*) auth="$2";; esac; shift 2;;
    -w|-X|-m|--connect-timeout|--max-time|-o) shift 2;;
    http*) url="$1"; shift;;
    *) shift;;
  esac
done
[ -f "$D/down" ] && exit 7
field() { printf '%s' "$data" | python3 -c "import json,sys;print(json.load(sys.stdin).get('$1',''))"; }
serial=$(field device_name); owner=$(field locked_by); ttl=$(field ttl_minutes)
case "$url" in
  */device-locks/acquire)
    echo "acquire $serial $owner $ttl $auth" >> "$D/calls.log"
    if [ -f "$D/unknown-$serial" ]; then printf '{"success":false,"error":"Unknown device: %s"}\n404' "$serial"; exit 0; fi
    if [ -f "$D/busy-$serial" ]; then printf '{"acquired":false,"locked_by":"%s","expires_at":"2026-10-11T14:00:00.000Z"}\n200' "$(cat "$D/busy-$serial")"; exit 0; fi
    if [ -f "$D/held-$serial" ] && [ "$(cat "$D/held-$serial")" != "$owner" ]; then
      printf '{"acquired":false,"locked_by":"%s","expires_at":"2026-10-11T14:00:00.000Z"}\n200' "$(cat "$D/held-$serial")"; exit 0
    fi
    printf '%s' "$owner" > "$D/held-$serial"
    printf '{"acquired":true,"lock":{"device_name":"%s","locked_by":"%s"}}\n200' "$serial" "$owner";;
  */device-locks/release)
    echo "release $serial $owner - $auth" >> "$D/calls.log"
    if [ -f "$D/held-$serial" ] && [ "$(cat "$D/held-$serial")" = "$owner" ]; then
      rm -f "$D/held-$serial"; printf '{"success":true}\n200'
    else
      printf '{"success":false,"error":"not locked by %s"}\n409' "$owner"
    fi;;
  *) printf '{}\n404';;
esac
exit 0
