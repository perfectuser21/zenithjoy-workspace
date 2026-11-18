# picomatch 本地安全修补

这两份 npm 归档使用 picomatch 原始发布包和同目录的补丁。许可随原始包保留。

| 原始版本 | npm 发布包 SHA-512（Base64） |
| --- | --- |
| 2.3.2 | `V7+vQEJ06Z+c5tSye8S+nHUfI51xoXIXjHQ99cQtKUkQqqO1kO/KCJUfZXuB47h/YBlDhah2H3hdUGXn8ie0oA==` |
| 4.0.7 | `qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==` |

从 npm 获取对应版本，核对上表完整性后解包。在解包目录的 `package/` 下运行 `patch -p1 < <对应版本的 .patch>`，再用 `npm pack` 生成归档。补丁对 [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) 采用保守处理。可化为单一字符类的重复匹配保留既有安全展开，其余含星号的重复扩展通配符由 picomatch 当作字面量。普通通配符和不含星号的重复匹配继续使用原有逻辑。

根目录与 Dashboard 独立锁文件均锁定这些归档。CI 会验证已审核的 SHA-512 和所有锁定副本，只有补丁覆盖的公告及其传递影响才按已修复处理。上游发布兼容修复后，升级依赖并删除归档、override 和此公告的核验逻辑。
