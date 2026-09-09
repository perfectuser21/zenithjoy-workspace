# 客户端「我的作品」页（line01 刀5a）（2026-09-09）

## 任务简述
客户量产入口：dashboard MyWorksPage（卡片/编辑/发布/回执徽章/重发失败平台）+ apps/api contents 列表（回执聚合 latest-wins+首图签名降级）与编辑锁 API。

### 下次预防
- [ ] 按 payload 聚合任务回执必须 latest-wins（DISTINCT ON + created_at DESC）——重发产生同平台多条历史行，取行不定序=已成功平台双发。
- [ ] "空集合回落全量"的服务端便利语义（platforms 空→全量）对"子集重试"类调用方是雷：前端必须空集守卫，服务端语义要在 spec 里显式声明。
- [ ] 前端状态判定常量（成功三值/平台白名单）跨包无法 import 时，手抄副本必须注释同源位置并挂 H-3 类 sweep 清单。
- [ ] dashboard 新页三件套缺一不可：navigation 组件映射+菜单项+InstanceContext features 表（漏最后一个=菜单静默不显示）。
