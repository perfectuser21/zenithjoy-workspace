import re


def parse_status_bar(raw, binding):
    if not isinstance(raw,str) or len(raw)>4_000_000: raise ValueError('STATUS_BAR_INPUT_UNSAFE')
    blocks=re.split(r'(?=^  Window #)',raw,flags=re.M)
    matches=[b for b in blocks if re.match(r'^  Window #\d+ Window\{\S+ u0 StatusBar\}:',b)]
    shades=[b for b in blocks if re.match(r'^  Window #\d+ Window\{\S+ u0 NotificationShade\}:',b)]
    if len(matches)!=1: raise ValueError('STATUS_BAR_WINDOW_NOT_UNIQUE')
    if len(shades)!=1 or not re.search(r'^\s+isVisible=false\s*$',shades[0],re.M) or 'mHasSurface=false' not in shades[0]: raise ValueError('NOTIFICATION_SHADE_NOT_PROVEN_HIDDEN')
    block=matches[0]
    if not all(x in block for x in ['package=com.android.systemui','ty=STATUS_BAR','type=statusBars','source=FRAME','mHasSurface=true isReadyForDisplay()=true']) or not re.search(r'^\s+isVisible=true\s*$',block,re.M): raise ValueError('STATUS_BAR_PROVIDER_UNVERIFIED')
    displays=re.findall(r'\bmDisplayId=(\d+)\b',block)
    configurations=re.findall(r'^\s+mFullConfiguration=([^\n]+)',block,re.M)
    if displays!=['0'] or len(configurations)!=1 or re.findall(r'\bmDisplayRotation=(ROTATION_\d+)\b',configurations[0])!=['ROTATION_0']: raise ValueError('STATUS_BAR_DISPLAY_OR_ROTATION_CHANGED')
    frames=re.findall(r'^\s+Frames: parent=\[[^\n]+?display=(\[\d+,\d+\]\[\d+,\d+\]) frame=(\[\d+,\d+\]\[\d+,\d+\])',block,re.M)
    if len(frames)!=1: raise ValueError('STATUS_BAR_FRAME_UNVERIFIED')
    display,frame=([int(x) for x in re.findall(r'\d+',v)] for v in frames[0])
    width,height=binding['width'],binding['height']
    if display!=[0,0,width,height] or frame[:3]!=[0,0,width] or not 0<frame[3]<=height//10: raise ValueError('STATUS_BAR_BOUNDS_UNSAFE')
    return {'displayId':0,'rotation':0,'size':[width,height],'bounds':frame}


def agree_status_bar(current,approved,target,marketing):
    if not current or current!=approved: raise ValueError('STATUS_BAR_PROOF_CHANGED_OR_MISSING')
    box=current['bounds']
    for other in [target,marketing]:
        if max(box[0],other[0])<min(box[2],other[2]) and max(box[1],other[1])<min(box[3],other[3]): raise ValueError('STATUS_BAR_MASK_OVERLAP')
    return box
