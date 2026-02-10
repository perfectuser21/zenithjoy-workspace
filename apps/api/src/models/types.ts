// Work types
export interface Work {
  id?: string;
  title: string;
  body?: string;
  body_en?: string;
  content_type: 'text' | 'image' | 'video' | 'article' | 'audio';
  cover_image?: string;
  media_files?: MediaFile[];
  platform_links?: PlatformLinks;
  status?: 'draft' | 'ready' | 'published' | 'archived';
  account?: 'XXIP' | 'XXAI';
  is_featured?: boolean;
  is_viral?: boolean;
  archived?: boolean;
  custom_fields?: Record<string, any>;
  created_at?: string;
  scheduled_at?: string;
  first_published_at?: string;
  updated_at?: string;
  archived_at?: string;
}

export interface MediaFile {
  type: 'image' | 'video';
  url: string;
  thumbnail?: string;
  size?: number;
  caption?: string;
  order: number;
}

export interface PlatformLinks {
  douyin?: string;
  xiaohongshu?: string;
  toutiao?: string;
  kuaishou?: string;
  weibo?: string;
  zhihu?: string;
  channels?: string;
}

// FieldDefinition types
export interface FieldDefinition {
  id?: string;
  field_name: string;
  field_type: 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'number' | 'checkbox';
  options?: string[];
  display_order?: number;
  is_visible?: boolean;
  created_at?: string;
  updated_at?: string;
}

// PublishLog types
export interface PublishLog {
  id?: string;
  work_id: string;
  platform: 'douyin' | 'xiaohongshu' | 'toutiao' | 'kuaishou' | 'weibo' | 'zhihu' | 'channels';
  platform_post_id?: string;
  status: 'pending' | 'publishing' | 'published' | 'failed';
  scheduled_at?: string;
  published_at?: string;
  response?: Record<string, any>;
  error_message?: string;
  retry_count?: number;
  created_at?: string;
}

// API Response types
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface ListResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
