import path from 'path';
import fs from 'fs';

export interface PhoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateSpec {
  id: string;
  name: string;
  aspect: '9:16' | '16:9';
  width: number;
  height: number;
  duration: number;
  jsxFile: string;
  component: string;
  phoneRect?: PhoneRect;
}

const TEMPLATES_DIR = path.join(__dirname);

export const TEMPLATE_REGISTRY: Record<string, TemplateSpec> = {
  'W-G': {
    id: 'W-G',
    name: '竖版 · Bauhaus 撞色',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    duration: 5,
    jsxFile: path.join(TEMPLATES_DIR, 'template-wg.jsx'),
    component: 'SlideWG',
    // PhonePreview width=400 at left:160 top:230, bezel=6px
    // screen: x=166, y=236, w=388, h=Math.round(400*812/375)-12=854
    phoneRect: { x: 166, y: 236, w: 388, h: 854 },
  },
  'C': {
    id: 'C',
    name: '横版 · 克制纪录片',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    duration: 5,
    jsxFile: path.join(TEMPLATES_DIR, 'template-c.jsx'),
    component: 'SlideC',
    // PhonePreview width=340, container left:60 top:100 w:620 h:870, flex-center
    // phone x=200 y=167, screen: x=206, y=173, w=328, h=724
    phoneRect: { x: 206, y: 173, w: 328, h: 724 },
  },
  'R': {
    id: 'R',
    name: '横版 · 深色高级感',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    duration: 5,
    jsxFile: path.join(TEMPLATES_DIR, 'template-r.jsx'),
    component: 'SlideR',
    // PhonePreview width=300, center of 3-col space-between (80-1840), vertically 200-880
    // phone x=810 y=215, screen: x=816, y=221, w=288, h=638
    phoneRect: { x: 816, y: 221, w: 288, h: 638 },
  },
};

export function getTemplate(id: string): TemplateSpec | null {
  return TEMPLATE_REGISTRY[id] ?? null;
}

export function readTemplateJsx(spec: TemplateSpec): string {
  if (!fs.existsSync(spec.jsxFile)) {
    const err = new Error(`template file not found: ${spec.id}`) as NodeJS.ErrnoException;
    err.code = 'TEMPLATE_NOT_FOUND';
    throw err;
  }
  return fs.readFileSync(spec.jsxFile, 'utf-8');
}
