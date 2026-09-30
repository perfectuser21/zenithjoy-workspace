## escort 三份投影对齐三档权限 + Commander 平滑收工 stop 文件入口（2026-09-30）

Brain 任务 2fc3b6fc，PR #2046，决策 ce4849e0（依据 018e4e84 / 3c98fb36 阶段 2）。

### 根本原因

- 阶段 2 #2043 只改了真身 `COMMANDER.md`，三份投影（escort SOP / stream 哨兵 SOP / 分身唤起词）没有跟着同步，escort、哨兵、分身仍按「无杀权、绝不终止 run」行事——宪法里写了「投影跟着同步」，但没有任何守卫把投影和真身钉在一起，改真身不改投影不会红。
- 「平滑收工」在真身里只有四步定义，执行器只认 #2036 的总时限 deadline，没有任何「请求收工」入口；Commander 想停一批只能 kill（不清手机现场、不放锁、账本 lost），所以投影就算写了「自动做平滑收工」也做不到。
- smoke 6b 反过来把旧宪法词「无杀权」当成必含项，投影一改就红——守卫锁死的是旧行为，而不是当前宪法。

### 下次预防

- [ ] 改 `COMMANDER.md` 任何权限条款时，先改 `__tests__/commander-projection-sync.test.mjs` 的断言，让三份投影跟着红，再改投影（守卫钉的是真身与投影的同一性，不是某个词）。
- [ ] 宪法里出现「允许做 X」的动作，必须同 PR 给出执行器侧的可执行入口（本次是 `~/wf-runs/<TAG>.stop`）并写进投影；只有定义没有入口的权限等于没有。
- [ ] 请求执行器停下的正规写法只有 `touch ~/wf-runs/<TAG>.stop`；任何 SOP / 唤起词 / 值守 prompt 里出现 `kill` wf-run / batch2 / harvest-keyword 的字样都算违反宪法，守卫 6b2 与 projection-sync 测试会拦。
- [ ] smoke 守卫断言宪法措辞时，断的是当前宪法关键词（三档 / 平滑收工 / .stop），旧词用「复活即红」的反向断言，不要把旧词当必含项。
- [ ] `escort-claude-escalation.sh` 的落点是 US-Mac `~/bin/`（LaunchAgent `com.zenithjoy.escortclaude`），deploy.sh 不覆盖本机；合并后必须手动 cp + `launchctl kickstart -k`，否则分身仍带旧唤起词跑（本次发现本机副本比仓库还老一版）。
