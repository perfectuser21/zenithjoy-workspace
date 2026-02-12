import { z } from 'zod';

// Work schemas
export const createWorkSchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().optional(),
  body_en: z.string().optional(),
  content_type: z.enum(['text', 'image', 'video', 'article', 'audio']),
  cover_image: z.string().optional(),
  media_files: z.array(z.object({
    type: z.enum(['image', 'video']),
    url: z.string(),
    thumbnail: z.string().optional(),
    size: z.number().optional(),
    caption: z.string().optional(),
    order: z.number()
  })).optional(),
  platform_links: z.record(z.string()).optional(),
  status: z.enum(['draft', 'ready', 'published', 'archived']).optional(),
  account: z.enum(['XXIP', 'XXAI']).optional(),
  is_featured: z.boolean().optional(),
  is_viral: z.boolean().optional(),
  custom_fields: z.record(z.any()).optional(),
  scheduled_at: z.string().optional(),
});

export const updateWorkSchema = createWorkSchema.partial();

// FieldDefinition schemas
export const createFieldSchema = z.object({
  field_name: z.string().min(1).max(100),
  field_type: z.enum(['text', 'textarea', 'select', 'multiselect', 'date', 'number', 'checkbox']),
  options: z.array(z.string()).optional(),
  display_order: z.number().optional(),
  is_visible: z.boolean().optional(),
});

export const updateFieldSchema = createFieldSchema.partial();

// PublishLog schemas
export const createPublishLogSchema = z.object({
  work_id: z.string().uuid(),
  platform: z.enum(['douyin', 'xiaohongshu', 'toutiao', 'kuaishou', 'weibo', 'zhihu', 'channels']),
  platform_post_id: z.string().optional(),
  status: z.enum(['pending', 'publishing', 'published', 'failed']).optional(),
  scheduled_at: z.string().optional(),
  response: z.record(z.any()).optional(),
  error_message: z.string().optional(),
});

export const updatePublishLogSchema = z.object({
  status: z.enum(['pending', 'publishing', 'published', 'failed']).optional(),
  platform_post_id: z.string().optional(),
  published_at: z.string().optional(),
  response: z.record(z.any()).optional(),
  error_message: z.string().optional(),
  retry_count: z.number().optional(),
});
