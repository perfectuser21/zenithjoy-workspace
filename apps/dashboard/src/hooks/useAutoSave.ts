import { useEffect, useRef, useCallback } from 'react';

export interface UseAutoSaveOptions<T> {
  data: T;
  onSave: (data: T) => Promise<void>;
  delay?: number;
  enabled?: boolean;
}

export interface UseAutoSaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  triggerSave: () => void;
}

export function useAutoSave<T>({
  data,
  onSave,
  delay = 2000,
  enabled = true,
}: UseAutoSaveOptions<T>): UseAutoSaveReturn {
  const timerRef = useRef<NodeJS.Timeout>();
  const isSavingRef = useRef(false);
  const lastSavedRef = useRef<Date | null>(null);
  const dataRef = useRef<T>(data);

  // 更新数据引用
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // 保存函数
  const save = useCallback(async () => {
    if (isSavingRef.current) return;

    try {
      isSavingRef.current = true;
      await onSave(dataRef.current);
      lastSavedRef.current = new Date();
    } catch (error) {
      console.error('Auto-save failed:', error);
    } finally {
      isSavingRef.current = false;
    }
  }, [onSave]);

  // 手动触发保存
  const triggerSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    save();
  }, [save]);

  // 自动保存逻辑
  useEffect(() => {
    if (!enabled) return;

    // 清除之前的定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 设置新的定时器
    timerRef.current = setTimeout(() => {
      save();
    }, delay);

    // 清理函数
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [data, delay, enabled, save]);

  // 组件卸载时保存
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      // 组件卸载时立即保存
      if (enabled && !isSavingRef.current) {
        onSave(dataRef.current).catch(console.error);
      }
    };
  }, [enabled, onSave]);

  return {
    isSaving: isSavingRef.current,
    lastSaved: lastSavedRef.current,
    triggerSave,
  };
}
