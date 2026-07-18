import uiautomation as auto

root = auto.GetRootControl()
main = None
for win in root.GetChildren():
    if (win.ClassName or '') == 'mmui::MainWindow':
        main = win
        break

if not main:
    print('main not found')
else:
    print('window: ' + repr(main.Name) + ' rect=' + str(main.BoundingRectangle))

    def walk(ctrl, depth, max_depth=7):
        if depth > max_depth:
            return
        name = ctrl.Name or ''
        aid = ctrl.AutomationId or ''
        rect = ctrl.BoundingRectangle
        marker = ''
        if any(k in name for k in [u'通话', u'语音', u'电话', u'视频']):
            marker = '  <<<< CALL KEYWORD'
        print('  ' * depth + '[' + ctrl.ControlTypeName + '] Name=' + repr(name) + ' AID=' + repr(aid) + ' rect=(' + str(rect.left) + ',' + str(rect.top) + ',' + str(rect.right) + ',' + str(rect.bottom) + ')' + marker)
        try:
            for c in ctrl.GetChildren():
                walk(c, depth + 1, max_depth)
        except Exception:
            pass

    walk(main, 0)
