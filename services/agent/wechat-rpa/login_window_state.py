"""登录页分类：标题不是登录状态，优先使用同一窗口的实际控件。"""


def login_window_kind(window):
    """只读 UIA；扫码页与隐私锁共用 mmui::LoginWindow/title=微信。"""
    info = window.element_info
    cls, title = info.class_name, info.name or ''
    if cls not in ('mmui::LoginWindow', 'Qt51514QWindowIcon'):
        return None
    if title == '登录':
        return 'scan_login'
    controls = set()
    try:
        for child in window.descendants():
            try:
                child_info = child.element_info
                controls.add((child_info.name or '', child_info.control_type))
            except Exception:
                continue
    except Exception:
        pass
    # 两个独立控件共同证明扫码页；聊天文本提到“扫码登录”不算。
    if ('二维码', 'Button') in controls and ('扫码登录', 'Text') in controls:
        return 'scan_login'
    if cls == 'mmui::LoginWindow' and title == '微信':
        if ('进入微信', 'Button') in controls:
            return 'welcome_screen'
        return 'privacy_lock'
    return None
