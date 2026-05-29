-- agents 表加 os_type 字段（'win32' | 'darwin' | 'linux'）
-- me/status 用此字段优先返回 win32 客户端，避免服务器 agent 抢占任务派发

ALTER TABLE zenithjoy.agents
  ADD COLUMN IF NOT EXISTS os_type TEXT;
