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

1. **人以平台为准**：`Employee.id` = 平台 `user.id`；姓名、部门、各家身份从 `/api/open/users` 同步，应用里不改。应用只多存平台没有的人事字段（入职日期、参加工作日期、档案）
2. **考勤数据以钉钉 / 飞书 / 企业微信为准**：打卡、请假、出差、外出都只同步、只读（`Punch`、`Absence`），本应用不提交、不审批请假（`LeaveRequest` 只留着 0.2.x 的旧数据）。新功能做统计和全景，不要加审批流
3. **权限写在 `services/`**，路由保持薄：`wrap(req => svc.fn(req.ctx, ...))`；`ctx = { user, via: 'WEB' | 'AI' }`。能看谁一律走 `services/access.js`（`isHr` / `visibleScope` / `canSee`），不要另写判断
4. **写操作留痕**：`audit(ctx, '对象.动作', { entityType, entityId, detail })`，同时上报平台使用数据；`detail` 里不放请假事由原文、手机号、导入的档案内容（只记数量）
5. **余额只追加流水**（`LeaveLedger`），不改不删；同步来的请假按记录对账（`absenceId`：应扣 − 已扣，补差额），扣减 / 退回和记录变化在同一个事务里，并先 `SELECT … FOR UPDATE` 锁员工行
6. **加一家打卡来源** = 在 `src/providers/` 写一个适配器（形状见 `providers/index.js`），把各家结果映射到统一的 `kind` / `result`（假勤映射到 `category` LEAVE / TRIP / OUT），`externalId` 要稳定（重拉时靠它去重、靠它判断撤销），并在 `test/providers.test.js` 用桩测映射和请求
7. 日期一律用 `YYYY-MM-DD` 字符串表示考勤日，时刻用 `Date`，换算只用 `lib/dates.js`（按设置的时区）；纯逻辑放 `lib/` 并写单元测试
8. **新增 AI 能力** = 在 `src/mcp.js` 的 `TOOLS` 加一个；只读的标 `readOnlyHint: true`，会改数据的不标。`get_key_metrics` / `get_daily_summary` / `list_pending_decisions` 是平台约定的名字，不要改
9. 设置放 `Setting` 表（`services/settings.js` 的 `SCHEMA`，前端按它渲染），不要加环境变量；环境变量只放密钥（打卡凭证）
10. 表结构改动向前兼容（先加字段、后删字段）：平台回滚只回代码不回数据库
11. 前端请求、链接用相对路径（`api/x`，不是 `/api/x`），路由用 hash：应用挂在 `/apps/hr/` 下
12. `src/lib/yh-one.mjs` 是平台 SDK 的副本，以平台仓库 `console/frontend/public/sdk/yh-one.mjs` 为准，不要在这里改
13. **人员数据的可见范围**都在 `services/access.js`：`contractScope`（人事全部，负责人看下属——设置能关，本人看自己）、`costScope`（人事全部，负责人看下属——设置能关，看不到自己）、`canLog1v1`（人事或负责人，不能给自己记）。新接口按它们收敛，不要另写判断
14. **敏感内容不出应用**：成本金额、1v1 纪要和私人备注、导入的原始纪要、合同内容不放进 `audit` 的 `detail`（它会上报平台使用数据）；1v1 的私人备注只给记录人和人事；原始纪要（文件、全文）给记录人、上级、人事，本人只在 `sourceShared` 时能看。纪要文件的 key 固定是 `one-on-ones/<userId>/…`（保存时校验）
15. 合同、成本、画像的规则（状态、法定试用期上限、竞业限制期、按标准生成成本、要留意的标记）是纯逻辑，放在 `lib/contracts.js`、`lib/cost.js`、`lib/portrait.js`，改了要补 `test/people.test.js`
16. 合同文件放平台文件存储，key 固定是 `contracts/<userId>/…`（保存时校验），下载只走 `GET /api/contracts/:id/file`（检查权限后跳限时地址）
17. **智能导入**：规则在 `lib/importer.js`（表头同义词、值的规范化、比对，改了补 `test/importer.test.js`），对人在 `lib/nameMatch.js`（只有工号、完全相同、确认过的别名能直接认，其余一律要人事确认；改了补 `test/nameMatch.test.js`），大模型只认规则认不出的（`services/importer.js`，走平台 `ws.llm`），模型的输出也要再过规则校验；一律先预览、确认后才写
18. **考勤 / 考核豁免**（`Employee.exemption`：ATTENDANCE 免考勤 / FULL 不参与考核）：判断只用 `lib/exemption.js` 的 `attendanceExempt` / `evaluationExempt`。新加的考勤统计要排除免考勤的人，新加的人员指标、成本统计要排除不参与考核的人；名单、档案、明细里照常显示（带标签）
19. **从钉钉 / 飞书补全档案**（`services/profileSync.js`）：只读不写回；三方比对的规则在 `lib/vendorProfile.js`（改了补 `test/vendorProfile.test.js`），不要直接覆盖这里的值；平台给的字段（姓名、部门、平台上有的工号）仍以平台为准
20. **分析建议助手**（`services/advisor.js`，规则在 `lib/advisor.js`）：直接用 `mcp.js` 的 `TOOLS` 里只读的那些，不另写查询、不另判权限；要让它看到新数据（比如以后的 OKR），就加一个标 `readOnlyHint` 的工具。对话不落库，留痕不记问答原文
