# 上游全量版本比较（脚本生成物）

由 `node scripts/upstream-matrix.mjs` 生成，逐上游版本对照本仓库 HEAD；启发式判定，仅用于找候选，逐项结论仍需人工核对。

- 上游版本数：22（v0.1.0 → v0.1.21）
- 对照范围：排除上游 docs/.github/Casks/锁文件
- 「本地偏薄」阈值：本地 < 上游 × 0.6（且上游 ≥ 60 行）

## 总览

| 版本    | 日期       | 改动 | 新增 | 本地缺 | 本地偏薄 | 本地更大 |
| ------- | ---------- | ---- | ---- | ------ | -------- | -------- |
| v0.1.1  | 2026-10-06 | 22   | 3    | 0      | 0        | 6        |
| v0.1.2  | 2026-10-07 | 5    | 0    | 0      | 0        | 1        |
| v0.1.3  | 2026-10-09 | 55   | 19   | 0      | 0        | 20       |
| v0.1.4  | 2026-10-09 | 18   | 0    | 0      | 0        | 3        |
| v0.1.5  | 2026-10-09 | 5    | 0    | 0      | 0        | 1        |
| v0.1.6  | 2026-10-09 | 54   | 20   | 10     | 0        | 17       |
| v0.1.7  | 2026-10-10 | 33   | 6    | 3      | 0        | 5        |
| v0.1.8  | 2026-10-10 | 11   | 2    | 2      | 0        | 1        |
| v0.1.9  | 2026-10-10 | 17   | 0    | 0      | 0        | 4        |
| v0.1.10 | 2026-10-11 | 19   | 6    | 0      | 0        | 4        |
| v0.1.11 | 2026-10-12 | 34   | 9    | 5      | 0        | 7        |
| v0.1.12 | 2026-10-12 | 32   | 13   | 3      | 1        | 6        |
| v0.1.13 | 2026-10-13 | 26   | 3    | 1      | 0        | 4        |
| v0.1.14 | 2026-10-13 | 38   | 8    | 2      | 2        | 6        |
| v0.1.15 | 2026-10-14 | 17   | 2    | 2      | 0        | 4        |
| v0.1.16 | 2026-10-14 | 18   | 0    | 0      | 1        | 3        |
| v0.1.17 | 2026-10-15 | 38   | 13   | 15     | 1        | 6        |
| v0.1.18 | 2026-10-16 | 11   | 0    | 5      | 0        | 0        |
| v0.1.19 | 2026-10-16 | 27   | 8    | 10     | 2        | 2        |
| v0.1.20 | 2026-10-17 | 42   | 1    | 3      | 3        | 7        |
| v0.1.21 | 2026-10-18 | 18   | 5    | 5      | 0        | 2        |

## 本地缺失清单（按首次出现的上游版本）

| 文件                                              | 首见版本 | 所属 |
| ------------------------------------------------- | -------- | ---- |
| scripts/release-draft.mjs                         | v0.1.11  | 其他 |
| scripts/release-draft.node-test.mjs               | v0.1.11  | 其他 |
| src/components/compose-forward-files.test.tsx     | v0.1.11  | 前端 |
| src/components/mail-filters.tsx                   | v0.1.11  | 前端 |
| src/lib/release-notes.ts                          | v0.1.12  | 前端 |
| src/lib/rich-body.test.ts                         | v0.1.12  | 前端 |
| src/lib/rich-image-size.test.ts                   | v0.1.12  | 前端 |
| src/components/remote-folder-list.test.tsx        | v0.1.13  | 前端 |
| scripts/mac-print.node-test.mjs                   | v0.1.14  | 其他 |
| src-tauri/src/proxy.rs                            | v0.1.15  | Rust |
| src/components/network-proxy-settings.tsx         | v0.1.15  | 前端 |
| src-tauri/src/mail_images.rs                      | v0.1.17  | Rust |
| src-tauri/src/mail_styles.rs                      | v0.1.17  | Rust |
| src-tauri/src/translation.rs                      | v0.1.17  | Rust |
| src/components/mail-translation-settings.test.tsx | v0.1.17  | 前端 |
| src/components/mail-translation-settings.tsx      | v0.1.17  | 前端 |
| src/components/translatable-mail-body.test.tsx    | v0.1.17  | 前端 |
| src/components/translatable-mail-body.tsx         | v0.1.17  | 前端 |
| src/lib/mail-image-decorations.test.ts            | v0.1.17  | 前端 |
| src/lib/mail-image-resources.ts                   | v0.1.17  | 前端 |
| src/lib/mail-translation.test.ts                  | v0.1.17  | 前端 |
| src/lib/mail-translation.ts                       | v0.1.17  | 前端 |
| src/lib/translation-activity.test.ts              | v0.1.17  | 前端 |
| scripts/mac-ci-signing.mjs                        | v0.1.19  | 其他 |
| scripts/mac-signing-secrets.mjs                   | v0.1.19  | 其他 |
| scripts/signing/anser-codesign.crt                | v0.1.19  | 其他 |
| scripts/signing/identity.json                     | v0.1.19  | 其他 |
| src-tauri/examples/keychain-migrate.rs            | v0.1.19  | Rust |
| src-tauri/src/credentials.rs                      | v0.1.19  | Rust |
| src-tauri/src/update_history.rs                   | v0.1.19  | Rust |
| src/lib/release-history.ts                        | v0.1.19  | 前端 |
| src/lib/demo-outbox.test.ts                       | v0.1.20  | 前端 |
| scripts/homebrew.mjs                              | v0.1.21  | 其他 |
| scripts/homebrew.node-test.mjs                    | v0.1.21  | 其他 |
| src/components/settings-layout.tsx                | v0.1.21  | 前端 |
| src/components/task-panel-header.test.tsx         | v0.1.21  | 前端 |
| src/components/task-panel-header.tsx              | v0.1.21  | 前端 |
| preview/index.html                                | v0.1.6   | 其他 |
| scripts/check-preview.mjs                         | v0.1.6   | 其他 |
| src-tauri/src/archive_location.rs                 | v0.1.6   | Rust |
| src/components/archive-integrity.tsx              | v0.1.6   | 前端 |
| src/components/archive-location.test.tsx          | v0.1.6   | 前端 |
| src/components/archive-location.tsx               | v0.1.6   | 前端 |
| src/lib/demo-storage.ts                           | v0.1.6   | 前端 |
| src/lib/preview-api.test.ts                       | v0.1.6   | 前端 |
| src/lib/preview-bridge.ts                         | v0.1.6   | 前端 |
| src/preview-main.tsx                              | v0.1.6   | 前端 |
| src-tauri/src/rule_runs.rs                        | v0.1.7   | Rust |
| src/components/rule-runs.test.tsx                 | v0.1.7   | 前端 |
| src/components/rule-runs.tsx                      | v0.1.7   | 前端 |
| LICENSE                                           | v0.1.8   | 其他 |
| NOTICE                                            | v0.1.8   | 其他 |

## 本地偏薄清单（可能只搬了一部分）

| 文件                                         | 首见版本 | 上游行数 | 本地上次记录行数 |
| -------------------------------------------- | -------- | -------- | ---------------- |
| src/lib/rich-body.ts                         | v0.1.12  | 103      | 61               |
| src/components/mail-content-loading.test.tsx | v0.1.14  | 168      | 90               |
| src/lib/remote-folders.test.ts               | v0.1.14  | 158      | 59               |
| src/components/app-updates.test.tsx          | v0.1.19  | 395      | 166              |
| src-tauri/src/rules.rs                       | v0.1.20  | 690      | 176              |
| src/components/rules-panel.test.tsx          | v0.1.20  | 430      | 224              |
| src/lib/demo-rules.test.ts                   | v0.1.20  | 107      | 64               |

## 逐版本明细（仅列需关注项）

### v0.1.6（e8e049d 2026-10-09）

- 本地缺：preview/index.html (2)
- 本地缺：scripts/check-preview.mjs (30)
- 本地缺：src-tauri/src/archive_location.rs (452)
- 本地缺：src/components/archive-integrity.tsx (84)
- 本地缺：src/components/archive-location.test.tsx (88)
- 本地缺：src/components/archive-location.tsx (217)
- 本地缺：src/lib/demo-storage.ts (17)
- 本地缺：src/lib/preview-api.test.ts (52)
- 本地缺：src/lib/preview-bridge.ts (25)
- 本地缺：src/preview-main.tsx (9)

### v0.1.7（1de47d7 2026-10-10）

- 本地缺：src-tauri/src/rule_runs.rs (1159)
- 本地缺：src/components/rule-runs.test.tsx (97)
- 本地缺：src/components/rule-runs.tsx (235)

### v0.1.8（f118cf3 2026-10-10）

- 本地缺：LICENSE (79)
- 本地缺：NOTICE (29)

### v0.1.11（652fad5 2026-10-12）

- 本地缺：scripts/release-draft.mjs (269)
- 本地缺：scripts/release-draft.node-test.mjs (230)
- 本地缺：src/components/compose-forward-files.test.tsx (204)
- 本地缺：src/components/mail-filters.tsx (137)
- 本地缺：src/lib/preview-bridge.ts (28)

### v0.1.12（996738d 2026-10-12）

- 本地缺：src/lib/release-notes.ts (67)
- 本地缺：src/lib/rich-body.test.ts (162)
- 本地缺：src/lib/rich-image-size.test.ts (106)
- 本地偏薄：src/lib/rich-body.ts (上游 103 / 本地 61)

### v0.1.13（887e297 2026-10-13）

- 本地缺：src/components/remote-folder-list.test.tsx (71)

### v0.1.14（f1921c2 2026-10-13）

- 本地缺：scripts/mac-print.node-test.mjs (13)
- 本地缺：src/components/remote-folder-list.test.tsx (126)
- 本地偏薄：src/components/mail-content-loading.test.tsx (上游 168 / 本地 90)
- 本地偏薄：src/lib/remote-folders.test.ts (上游 158 / 本地 59)

### v0.1.15（63fb6c2 2026-10-14）

- 本地缺：src-tauri/src/proxy.rs (393)
- 本地缺：src/components/network-proxy-settings.tsx (266)

### v0.1.16（8a13673 2026-10-14）

- 本地偏薄：src/components/mail-content-loading.test.tsx (上游 172 / 本地 90)

### v0.1.17（7312e5c 2026-10-15）

- 本地缺：src-tauri/src/mail_images.rs (310)
- 本地缺：src-tauri/src/mail_styles.rs (231)
- 本地缺：src-tauri/src/proxy.rs (446)
- 本地缺：src-tauri/src/translation.rs (1444)
- 本地缺：src/components/mail-translation-settings.test.tsx (319)
- 本地缺：src/components/mail-translation-settings.tsx (606)
- 本地缺：src/components/network-proxy-settings.tsx (266)
- 本地缺：src/components/translatable-mail-body.test.tsx (228)
- 本地缺：src/components/translatable-mail-body.tsx (254)
- 本地缺：src/lib/mail-image-decorations.test.ts (83)
- 本地缺：src/lib/mail-image-resources.ts (91)
- 本地缺：src/lib/mail-translation.test.ts (343)
- 本地缺：src/lib/mail-translation.ts (575)
- 本地缺：src/lib/preview-api.test.ts (78)
- 本地缺：src/lib/translation-activity.test.ts (66)
- 本地偏薄：src/components/mail-content-loading.test.tsx (上游 229 / 本地 90)

### v0.1.18（7122409 2026-10-16）

- 本地缺：src-tauri/src/translation.rs (1689)
- 本地缺：src/components/translatable-mail-body.test.tsx (289)
- 本地缺：src/components/translatable-mail-body.tsx (249)
- 本地缺：src/lib/mail-translation.test.ts (407)
- 本地缺：src/lib/mail-translation.ts (627)

### v0.1.19（037d7aa 2026-10-16）

- 本地缺：scripts/mac-ci-signing.mjs (114)
- 本地缺：scripts/mac-signing-secrets.mjs (42)
- 本地缺：scripts/signing/anser-codesign.crt (26)
- 本地缺：scripts/signing/identity.json (5)
- 本地缺：src-tauri/examples/keychain-migrate.rs (35)
- 本地缺：src-tauri/src/credentials.rs (547)
- 本地缺：src-tauri/src/proxy.rs (477)
- 本地缺：src-tauri/src/translation.rs (1673)
- 本地缺：src-tauri/src/update_history.rs (472)
- 本地缺：src/lib/release-history.ts (44)
- 本地偏薄：src/components/app-updates.test.tsx (上游 395 / 本地 166)
- 本地偏薄：src/components/mail-content-loading.test.tsx (上游 262 / 本地 90)

### v0.1.20（eb80fa4 2026-10-17）

- 本地缺：src-tauri/src/rule_runs.rs (1299)
- 本地缺：src/components/remote-folder-list.test.tsx (237)
- 本地缺：src/lib/demo-outbox.test.ts (43)
- 本地偏薄：src-tauri/src/rules.rs (上游 690 / 本地 176)
- 本地偏薄：src/components/rules-panel.test.tsx (上游 430 / 本地 224)
- 本地偏薄：src/lib/demo-rules.test.ts (上游 107 / 本地 64)

### v0.1.21（1229985 2026-10-18）

- 本地缺：scripts/homebrew.mjs (268)
- 本地缺：scripts/homebrew.node-test.mjs (220)
- 本地缺：src/components/settings-layout.tsx (79)
- 本地缺：src/components/task-panel-header.test.tsx (163)
- 本地缺：src/components/task-panel-header.tsx (88)
