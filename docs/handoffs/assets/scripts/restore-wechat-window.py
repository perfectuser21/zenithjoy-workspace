import win32gui
import win32process
import win32con
import psutil
import time

target_pids = set()
for p in psutil.process_iter(['pid', 'name']):
    if p.info['name'] and p.info['name'].lower() == 'weixin.exe':
        target_pids.add(p.info['pid'])
print('weixin pids: ' + str(target_pids))

found = []
def cb(hwnd, _):
    if not win32gui.IsWindow(hwnd):
        return True
    _, pid = win32process.GetWindowThreadProcessId(hwnd)
    if pid in target_pids:
        cls = win32gui.GetClassName(hwnd)
        title = win32gui.GetWindowText(hwnd)
        visible = win32gui.IsWindowVisible(hwnd)
        found.append((hwnd, cls, title, visible))
    return True
win32gui.EnumWindows(cb, None)

print('found ' + str(len(found)) + ' windows belonging to weixin.exe')
for hwnd, cls, title, visible in found:
    print(' - hwnd=' + str(hwnd) + ' cls=' + repr(cls) + ' title=' + repr(title) + ' visible=' + str(visible))

for hwnd, cls, title, visible in found:
    if cls == 'mmui::MainWindow':
        print('restoring mmui::MainWindow hwnd=' + str(hwnd))
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
        try:
            win32gui.SetForegroundWindow(hwnd)
        except Exception as e:
            print('setforeground warn: ' + str(e))

time.sleep(1)
print('done')
