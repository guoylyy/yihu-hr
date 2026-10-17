# CLAUDE.md

人事考勤：插在以虎 One 上的代码应用（`code: hr`，不能改）。先读 `README.md`；平台的接入规则在 `../yihu-one/docs/应用接入规范.md`，开发中心文档在 `../yihu-one/console/docs/devcenter/`。

## 常用命令

```bash
cd backend && npm test                      # 单元测试（node:test，不需要数据库）
cd backend && npm run dev                   # :3006，本地开发模式见 README
cd backend && npx prisma migrate dev --name <名称>   # 改 schema.prisma 后，迁移文件要提交
cd frontend && npm run dev                  # :5186
cd frontend && npm run build                # 前端没有测试，至少确认能构建
./release.sh                                # 发布（只在 main 上，测试过了才推 release）
./bump-version.sh 0.3.0                     # 改版本号（前后端 package.json + CHANGELOG.md 一节待填；只用它改）
```

## 约定

1. **人以平台为准**：`Employee.id` = 平台 `user.id`；姓名、部门、各家身份从 `/api/open/users` 同步，应用里不改。应用只多存平台没有的人事字段（入职日期、参加工作日期、指定审批人）
2. **权限写在 `services/`**，路由保持薄：`wrap(req => svc.fn(req.ctx, ...))`；`ctx = { user, via: 'WEB' | 'AI' }`。能看谁一律走 `services/access.js`（`isHr` / `visibleScope` / `canSee`），不要另写判断
3. **写操作留痕**：`audit(ctx, '对象.动作', { entityType, entityId, detail })`，同时上报平台使用数据；`detail` 里不放请假事由原文、手机号
4. **余额只追加流水**（`LeaveLedger`），不改不删；扣减 / 退回和请假状态变化在同一个事务里，并先 `SELECT … FOR UPDATE` 锁员工行
5. **加一家打卡来源** = 在 `src/providers/` 写一个适配器（形状见 `providers/index.js`），把各家结果映射到统一的 `kind` / `result`，`externalId` 要稳定（重拉时靠它去重），并在 `test/providers.test.js` 用桩测映射和请求
6. 日期一律用 `YYYY-MM-DD` 字符串表示考勤日，时刻用 `Date`，换算只用 `lib/dates.js`（按设置的时区）；纯逻辑放 `lib/` 并写单元测试
7. **新增 AI 能力** = 在 `src/mcp.js` 的 `TOOLS` 加一个；只读的标 `readOnlyHint: true`，会改数据的不标。`get_key_metrics` / `get_daily_summary` / `list_pending_decisions` 是平台约定的名字，不要改
8. 设置放 `Setting` 表（`services/settings.js` 的 `SCHEMA`，前端按它渲染），不要加环境变量；环境变量只放密钥（打卡凭证）
9. 表结构改动向前兼容（先加字段、后删字段）：平台回滚只回代码不回数据库
10. 前端请求、链接用相对路径（`api/x`，不是 `/api/x`），路由用 hash：应用挂在 `/apps/hr/` 下
11. `src/lib/yh-one.mjs` 是平台 SDK 的副本，以平台仓库 `console/frontend/public/sdk/yh-one.mjs` 为准，不要在这里改
12. **人员数据的可见范围**都在 `services/access.js`：`contractScope`（人事全部，负责人看下属——设置能关，本人看自己）、`costScope`（人事全部，负责人看下属——设置能关，看不到自己）、`canLog1v1`（人事或负责人，不能给自己记）。新接口按它们收敛，不要另写判断
13. **敏感内容不出应用**：成本金额、1v1 纪要和私人备注、合同内容不放进 `audit` 的 `detail`（它会上报平台使用数据）；1v1 的私人备注只给记录人和人事
14. 合同、成本、画像的规则（状态、法定试用期上限、竞业限制期、按标准生成成本、要留意的标记）是纯逻辑，放在 `lib/contracts.js`、`lib/cost.js`、`lib/portrait.js`，改了要补 `test/people.test.js`
15. 合同文件放平台文件存储，key 固定是 `contracts/<userId>/…`（保存时校验），下载只走 `GET /api/contracts/:id/file`（检查权限后跳限时地址）
