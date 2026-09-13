# 个人片单与豆瓣导入

个人片单按登录身份保存在服务端；普通会员按 memberId 隔离，管理员使用独立管理员片单。导入原文件中的 userId 不参与身份判断。普通浏览器缓存仅作为旧版数据迁移来源，不再作为片单主存储。

## 冲突策略

- 完全替换为豆瓣：最终片单只包含本文件记录，清除缺席记录和空值对应的旧信息。需要再次勾选确认；日期筛选文件显示提醒。
- 融合，豆瓣优先：保留双方独有影片；重叠影片状态/日期采用豆瓣，评分、短评和标签采用豆瓣非空值，否则保留本站值。
- 融合，本站优先（默认）：保留双方独有影片；重叠影片状态/日期采用本站，个人字段在本站为空时由豆瓣补齐。

状态与标记日期作为一组处理；空标记日期表示未知，不能将导入时间展示为观影时间。文件内相同 subjectId 取较新的标记日期，同日取最后一条，并报告去重数量。当前版本支持纳豆 JSON，不支持 CSV。

## API

所有路由经过现有身份认证和 CSRF 检查，响应 Cache-Control 为 private, no-store。客户端不能指定 owner/memberId。

- GET /api/member/collection：获取个人片单及 revision；按当前全库索引刷新资源关联。
- POST /api/member/collection/preview：data 为导出对象，strategy 为 replace / douban / site；返回行级差异、匹配结果及预览 ID。
- POST /api/member/collection/commit：提交 id；完整替换要求 confirmReplace=true。
- POST /api/member/collection/mark：assetKey、mark、active、revision；保存想看/在看/已看，三者互斥。
- POST /api/member/collection/undo：id、revision；撤销最近一次导入，导入后有其他修改时拒绝撤销。

预览 30 分钟有效，每个账号只保留最新预览；预览不会修改片单。提交检查预览基准 revision，跨设备修改后返回 409，需要重新预览。相同提交 ID 在未发生后续操作时幂等。每次导入保留一次可撤销的旧片单，普通标记操作会使撤销失效。

## 存储与匹配

Azure 使用现有 Storage Account 中的私有 member-collections Blob 容器，文档名按身份键哈希；不生成公开链接或 SAS。账号片单及最近导入备份原子写入同一 Blob，使用 ETag 条件写防止多实例覆盖。最新预览单独一个 Blob，其过期仅限制提交，不代表立即物理删除。下次预览覆盖它。

本地开发使用 LOCAL_DATA_DIR/member-collections，采用锁文件、内容版本检查和原子重命名。意外进程终止遗留的 .lock 需要确认进程已停止后人工移除。

匹配调用 SearchIndexStore.listAllResults，使用已有索引快照缓存；不按浏览器加载范围采样，也不逐条请求 Notion。匹配键为 metadata.work.externalIds.douban / metadata.externalIds.douban。多个不同资源候选不随意选择，无匹配保留纳豆资料。缺少豆瓣 ID 的已收录影片仍可能显示未匹配，不做片名猜测。

上传限制 20 MB / 20,000 条。解析白名单字段，忽略导出账号标识和其他未知字段。个人评分不覆盖公共评分；不触发片源下载、Notion 发布或自动元数据回填。

旧版浏览器中带 doubanImport 的记录可通过迁移按钮重新生成服务端预览，原本地备份不删除。首次使用建议直接重新上传纳豆原始文件。

## 验证

node --import tsx --test apps/api/src/member-collection.test.ts apps/api/src/auth-http.test.ts
npm run typecheck --workspace @wwpdw/api
npm run build --workspace @wwpdw/web

隔离网页实测覆盖文件选择、1,768 条预览、保存后重新载入与撤销，不写入真实用户片单。
