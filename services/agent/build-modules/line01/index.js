// line01-publish stub 入口
// 被 core 通过 child_process.fork() 拉起，收到 config 即回 ready。
// 加厚时在此接入真实 Line 逻辑（参考 line04/index.ts IPC 协议）。
process.on('message', (msg) => {
    if (msg?.type === 'config')
        process.send?.({ type: 'ready' });
});
