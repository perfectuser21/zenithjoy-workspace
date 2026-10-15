"""纯截图读取专属预算。写动作走原Phone.run，15秒及不重试语义不变。"""
import os
import signal
import subprocess


def bounded_screenshot(argv):
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)
    try:
        out, _err = process.communicate(timeout=45)
    except BaseException:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate(timeout=2)
        raise
    if process.returncode:
        raise ValueError('screenshot_read_failed')
    return out


def screenshot_phone(base_phone):
    class ScreenshotBudgetPhone(base_phone):
        def run(self, *args):
            if args != ('exec-out', 'screencap', '-p'):
                return super().run(*args)
            self.require_owner()
            result = bounded_screenshot([self.adb, '-s', self.serial, *args])
            self.require_owner()
            return result
    return ScreenshotBudgetPhone
