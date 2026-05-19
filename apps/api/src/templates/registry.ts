import path from 'path';
import fs from 'fs';

export interface TemplateSpec {
  id: string;
  name: string;
  aspect: '9:16' | '16:9';
  width: number;
  height: number;
  duration: number;
  jsxFile: string;
  component: string;
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
