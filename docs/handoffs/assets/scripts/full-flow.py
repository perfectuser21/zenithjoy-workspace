"""诊断脚本，非生产代码 —— 仅用于本次微信 RPA 可行性调研，供下次开发参考。

⚠️ 可靠性警告（详见 docs/handoffs/202607180920-wechat-voice-call-rpa-research.md 第5节）：
- 本脚本操作的是微信自绘 UI（mmui 硬件加速渲染层），UIA 树读到"点击成功"不代表真实生效，
  必须配截图 ground truth 交叉验证，不能只信 UIA 返回值。
- 严禁在正在运行其他生产/RPA 任务的机器上执行本脚本 —— 程序化鼠标/键盘操作会抢占交互式桌面
  控制权，干扰同机运行的其他任务（已发生过一次真实事故，见第5节末尾记录）。执行前必须确认
  目标机器当前没有其他任务占用交互式桌面。
- 请勿在生产机器上无人值守运行；仅限人工在场情况下运行诊断。
"""
import win32gui
import win32process
import win32con
import psutil
import time
import uiautomation as auto

def log(msg):
    print(msg)

# Step 1: restore all weixin windows
target_pids = set()
for p in psutil.process_iter(['pid', 'name']):
    if p.info['name'] and p.info['name'].lower() == 'weixin.exe':
        target_pids.add(p.info['pid'])

found = []
def cb(hwnd, _):
    if not win32gui.IsWindow(hwnd):
        return True
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    if pid in target_pids:
        found.append(hwnd)
    return True
win32gui.EnumWindows(cb, None)
log('STEP1: found ' + str(len(found)) + ' weixin windows, restoring all')
for hwnd in found:
    try:
        win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    except Exception:
        pass

# Step 2: poll for mmui::MainWindow to appear via UIA (up to 8s)
main = None
for i in range(16):
    root = auto.GetRootControl()
    for win in root.GetChildren():
        if (win.ClassName or '') == 'mmui::MainWindow':
            main = win
            break
    if main:
        break
    time.sleep(0.5)

if not main:
    log('STEP2 FAIL: mmui::MainWindow did not appear after polling')
else:
    log('STEP2 OK: main window found, name=' + repr(main.Name))
    try:
        mhwnd = main.NativeWindowHandle
        win32gui.SetForegroundWindow(mhwnd)
    except Exception as e:
        log('setforeground warn: ' + str(e))
    main.SetActive()
    time.sleep(2.5)

    # Step 3: search
    edit = main.EditControl(searchDepth=15)
    ok = edit.Exists(6, 0.4)
    log('STEP3: edit exists=' + str(ok))
    if not ok:
        log('STEP3 DEBUG: dumping depth-2 children of main window')
        for c in main.GetChildren():
            log('  [' + c.ControlTypeName + '] Name=' + repr(c.Name))
            try:
                for c2 in c.GetChildren():
                    log('    [' + c2.ControlTypeName + '] Name=' + repr(c2.Name))
            except Exception:
                pass
    if ok:
        edit.Click(simulateMove=False)
        time.sleep(0.5)
        auto.SendKeys('{Ctrl}a{Delete}', waitTime=0.2)
        time.sleep(0.3)
        auto.SendKeys(u'默忆', interval=0.08)
        time.sleep(1.5)

        candidates = []
        def walk(ctrl, depth, max_depth=8):
            if depth > max_depth:
                return
            name = ctrl.Name or ''
            if name == u'默忆':
                candidates.append((ctrl.ControlTypeName, ctrl.BoundingRectangle))
            try:
                for c in ctrl.GetChildren():
                    walk(c, depth + 1, max_depth)
            except Exception:
                pass
        walk(main, 0)
        log('STEP4: candidates=' + str(len(candidates)))
        for ct, rect in candidates:
            log(' - ' + ct + ' ' + str(rect.left) + ',' + str(rect.top) + ',' + str(rect.right) + ',' + str(rect.bottom))

        if candidates:
            ct, rect = candidates[0]
            cx = (rect.left + rect.right) // 2
            cy = (rect.top + rect.bottom) // 2
            log('STEP5: clicking ' + str(cx) + ',' + str(cy))
            auto.Click(cx, cy)
            time.sleep(1.5)

            target = None
            for i in range(10):
                root2 = auto.GetRootControl()
                for win in root2.GetChildren():
                    cls2 = win.ClassName or ''
                    aid = win.AutomationId or ''
                    if 'mmui::ChatSingleWindow' in cls2 and 'chatroom' not in aid:
                        target = win
                        break
                if target:
                    break
                time.sleep(0.4)

            if target:
                log('STEP6 OK: dm window=' + repr(target.Name))
                try:
                    thwnd = target.NativeWindowHandle
                    win32gui.SetForegroundWindow(thwnd)
                except Exception as e:
                    log('setforeground2 warn: ' + str(e))
                target.SetActive()
                time.sleep(0.6)
                from PIL import ImageGrab
                r2 = target.BoundingRectangle
                img = ImageGrab.grab(bbox=(r2.left, r2.top, r2.right, r2.bottom))
                img.save('C:\\Users\\Public\\wxdiag_momoyi_dm.png')
                log('STEP7 OK: screenshot saved')
            else:
                log('STEP6 FAIL: dm window not found')
        else:
            log('STEP4 FAIL: no candidate')
log('DONE')
