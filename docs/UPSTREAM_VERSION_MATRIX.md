
> yanxin@0.20.2 upstream:matrix
> node scripts/upstream-matrix.mjs

# 上游全量版本比较（脚本生成物）

由 `node scripts/upstream-matrix.mjs --local=HEAD` 生成，逐上游版本对照本地 ref；启发式判定，仅用于找候选，逐项结论仍需人工核对。

- 本地基准 ref：`HEAD`

- 上游版本数：24（v0.1.0 → v0.1.23）
- 对照范围：排除上游 docs/.github/Casks/锁文件
- 「本地偏薄」阈值：本地 < 上游 × 0.6（且上游 ≥ 60 行）

## 总览

| 版本 | 日期 | 改动 | 新增 | 本地缺 | 本地偏薄 | 本地更大 |
| --- | --- | --- | --- | --- | --- | --- |
| v0.1.1 | 2026-10-06 | 22 | 3 | 0 | 0 | 8 |
| v0.1.2 | 2026-10-07 | 5 | 0 | 0 | 0 | 1 |
| v0.1.3 | 2026-10-09 | 55 | 19 | 0 | 0 | 22 |
| v0.1.4 | 2026-10-09 | 18 | 0 | 0 | 0 | 4 |
| v0.1.5 | 2026-10-09 | 5 | 0 | 0 | 0 | 1 |
| v0.1.6 | 2026-10-09 | 54 | 20 | 10 | 0 | 19 |
| v0.1.7 | 2026-10-10 | 33 | 6 | 1 | 0 | 10 |
| v0.1.8 | 2026-10-10 | 11 | 2 | 0 | 0 | 1 |
| v0.1.9 | 2026-10-10 | 17 | 0 | 0 | 0 | 6 |
| v0.1.10 | 2026-10-11 | 19 | 6 | 0 | 0 | 4 |
| v0.1.11 | 2026-10-12 | 34 | 9 | 5 | 0 | 10 |
| v0.1.12 | 2026-10-12 | 32 | 13 | 2 | 1 | 6 |
| v0.1.13 | 2026-10-13 | 26 | 3 | 1 | 0 | 4 |
| v0.1.14 | 2026-10-13 | 38 | 8 | 2 | 2 | 6 |
| v0.1.15 | 2026-10-14 | 17 | 2 | 2 | 0 | 4 |
| v0.1.16 | 2026-10-14 | 18 | 0 | 0 | 1 | 3 |
| v0.1.17 | 2026-10-15 | 38 | 13 | 15 | 1 | 6 |
| v0.1.18 | 2026-10-16 | 11 | 0 | 5 | 0 | 0 |
| v0.1.19 | 2026-10-16 | 27 | 8 | 8 | 1 | 2 |
| v0.1.20 | 2026-10-17 | 42 | 1 | 2 | 1 | 8 |
| v0.1.21 | 2026-10-18 | 18 | 5 | 2 | 0 | 2 |
| v0.1.22 | 2026-10-20 | 81 | 9 | 17 | 3 | 9 |
| v0.1.23 | 2026-10-20 | 4 | 0 | 0 | 0 | 0 |

## 本地缺失清单（按首次出现的上游版本）

| 文件 | 首见版本 | 所属 |
| --- | --- | --- |
| scripts/release-draft.mjs | v0.1.11 | 其他 |
| scripts/release-draft.node-test.mjs | v0.1.11 | 其他 |
| src/components/compose-forward-files.test.tsx | v0.1.11 | 前端 |
| src/components/mail-filters.tsx | v0.1.11 | 前端 |
| src/lib/rich-body.test.ts | v0.1.12 | 前端 |
| src/lib/rich-image-size.test.ts | v0.1.12 | 前端 |
| src/components/remote-folder-list.test.tsx | v0.1.13 | 前端 |
| scripts/mac-print.node-test.mjs | v0.1.14 | 其他 |
| src-tauri/src/proxy.rs | v0.1.15 | Rust |
| src/components/network-proxy-settings.tsx | v0.1.15 | 前端 |
| src-tauri/src/mail_images.rs | v0.1.17 | Rust |
| src-tauri/src/mail_styles.rs | v0.1.17 | Rust |
| src-tauri/src/translation.rs | v0.1.17 | Rust |
| src/components/mail-translation-settings.test.tsx | v0.1.17 | 前端 |
| src/components/mail-translation-settings.tsx | v0.1.17 | 前端 |
| src/components/translatable-mail-body.test.tsx | v0.1.17 | 前端 |
| src/components/translatable-mail-body.tsx | v0.1.17 | 前端 |
| src/lib/mail-image-decorations.test.ts | v0.1.17 | 前端 |
| src/lib/mail-image-resources.ts | v0.1.17 | 前端 |
| src/lib/mail-translation.test.ts | v0.1.17 | 前端 |
| src/lib/mail-translation.ts | v0.1.17 | 前端 |
| src/lib/translation-activity.test.ts | v0.1.17 | 前端 |
| scripts/mac-ci-signing.mjs | v0.1.19 | 其他 |
| scripts/mac-signing-secrets.mjs | v0.1.19 | 其他 |
| scripts/signing/anser-codesign.crt | v0.1.19 | 其他 |
| scripts/signing/identity.json | v0.1.19 | 其他 |
| src-tauri/examples/keychain-migrate.rs | v0.1.19 | Rust |
| src-tauri/src/credentials.rs | v0.1.19 | Rust |
| src/lib/demo-outbox.test.ts | v0.1.20 | 前端 |
| scripts/homebrew.mjs | v0.1.21 | 其他 |
| scripts/homebrew.node-test.mjs | v0.1.21 | 其他 |
| scripts/check-i18n.mjs | v0.1.22 | 其他 |
| src-tauri/src/interface_language.rs | v0.1.22 | Rust |
| src/components/language-settings.test.tsx | v0.1.22 | 前端 |
| src/components/language-settings.tsx | v0.1.22 | 前端 |
| src/lib/i18n.test.ts | v0.1.22 | 前端 |
| src/lib/i18n.ts | v0.1.22 | 前端 |
| src/locales/config.json | v0.1.22 | 前端 |
| src/locales/en.json | v0.1.22 | 前端 |
| src/locales/zh-CN.json | v0.1.22 | 前端 |
| preview/index.html | v0.1.6 | 其他 |
| scripts/check-preview.mjs | v0.1.6 | 其他 |
| src-tauri/src/archive_location.rs | v0.1.6 | Rust |
| src/components/archive-integrity.tsx | v0.1.6 | 前端 |
| src/components/archive-location.test.tsx | v0.1.6 | 前端 |
| src/components/archive-location.tsx | v0.1.6 | 前端 |
| src/lib/demo-storage.ts | v0.1.6 | 前端 |
| src/lib/preview-api.test.ts | v0.1.6 | 前端 |
| src/lib/preview-bridge.ts | v0.1.6 | 前端 |
| src/preview-main.tsx | v0.1.6 | 前端 |
| src/components/rule-runs.test.tsx | v0.1.7 | 前端 |

## 本地偏薄清单（可能只搬了一部分）

| 文件 | 首见版本 | 上游行数 | 本地上次记录行数 |
| --- | --- | --- | --- |
| src/lib/rich-body.ts | v0.1.12 | 103 | 61 |
| src/components/mail-content-loading.test.tsx | v0.1.14 | 168 | 90 |
| src/lib/remote-folders.test.ts | v0.1.14 | 158 | 59 |
| src/lib/demo-rules.test.ts | v0.1.20 | 107 | 64 |
| src/components/remote-folder-list.tsx | v0.1.22 | 282 | 165 |
| src/lib/remote-folders.ts | v0.1.22 | 178 | 95 |

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
- 本地缺：src/components/rule-runs.test.tsx (97)

### v0.1.11（652fad5 2026-10-12）
- 本地缺：scripts/release-draft.mjs (269)
- 本地缺：scripts/release-draft.node-test.mjs (230)
- 本地缺：src/components/compose-forward-files.test.tsx (204)
- 本地缺：src/components/mail-filters.tsx (137)
- 本地缺：src/lib/preview-bridge.ts (28)

### v0.1.12（996738d 2026-10-12）
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
- 本地偏薄：src/components/mail-content-loading.test.tsx (上游 262 / 本地 90)

### v0.1.20（eb80fa4 2026-10-17）
- 本地缺：src/components/remote-folder-list.test.tsx (237)
- 本地缺：src/lib/demo-outbox.test.ts (43)
- 本地偏薄：src/lib/demo-rules.test.ts (上游 107 / 本地 64)

### v0.1.21（1229985 2026-10-18）
- 本地缺：scripts/homebrew.mjs (268)
- 本地缺：scripts/homebrew.node-test.mjs (220)

### v0.1.22（0828545 2026-10-20）
- 本地缺：scripts/check-i18n.mjs (71)
- 本地缺：src-tauri/src/interface_language.rs (62)
- 本地缺：src/components/archive-integrity.tsx (90)
- 本地缺：src/components/archive-location.tsx (234)
- 本地缺：src/components/language-settings.test.tsx (97)
- 本地缺：src/components/language-settings.tsx (95)
- 本地缺：src/components/mail-filters.tsx (138)
- 本地缺：src/components/mail-translation-settings.tsx (630)
- 本地缺：src/components/network-proxy-settings.tsx (280)
- 本地缺：src/components/translatable-mail-body.tsx (258)
- 本地缺：src/lib/i18n.test.ts (50)
- 本地缺：src/lib/i18n.ts (71)
- 本地缺：src/lib/mail-translation.ts (631)
- 本地缺：src/lib/preview-bridge.ts (29)
- 本地缺：src/locales/config.json (8)
- 本地缺：src/locales/en.json (1198)
- 本地缺：src/locales/zh-CN.json (1198)
- 本地偏薄：src/components/remote-folder-list.tsx (上游 282 / 本地 165)
- 本地偏薄：src/lib/remote-folders.ts (上游 178 / 本地 95)
- 本地偏薄：src/lib/rich-body.ts (上游 104 / 本地 61)

## 双树比对：`HEAD` ↔ `upstream/tags/v0.1.23`

`git diff --name-status <本地 ref> <上游 tag>`：两棵树直接比，不依赖共同祖先。「上游独有」= 待移植候选；「本地独有」= 我们自研；「改名候选」= 可解释部分「本地缺」误报。

- 上游独有 **51** 个（其他 12、Rust 8、前端 31）
- 本地独有 **30** 个（其他 1、Rust 2、前端 27）
- 双方都有但内容不同 **144** 个
- 疑似改名对应 **0** 组

### 上游独有（待移植候选）

- preview/index.html
- scripts/check-i18n.mjs
- scripts/check-preview.mjs
- scripts/homebrew.mjs
- scripts/homebrew.node-test.mjs
- scripts/mac-ci-signing.mjs
- scripts/mac-print.node-test.mjs
- scripts/mac-signing-secrets.mjs
- scripts/release-draft.mjs
- scripts/release-draft.node-test.mjs
- scripts/signing/anser-codesign.crt
- scripts/signing/identity.json
- src-tauri/examples/keychain-migrate.rs
- src-tauri/src/archive_location.rs
- src-tauri/src/credentials.rs
- src-tauri/src/interface_language.rs
- src-tauri/src/mail_images.rs
- src-tauri/src/mail_styles.rs
- src-tauri/src/proxy.rs
- src-tauri/src/translation.rs
- src/components/archive-integrity.tsx
- src/components/archive-location.test.tsx
- src/components/archive-location.tsx
- src/components/compose-forward-files.test.tsx
- src/components/language-settings.test.tsx
- src/components/language-settings.tsx
- src/components/mail-filters.tsx
- src/components/mail-translation-settings.test.tsx
- src/components/mail-translation-settings.tsx
- src/components/network-proxy-settings.tsx
- src/components/remote-folder-list.test.tsx
- src/components/rule-runs.test.tsx
- src/components/translatable-mail-body.test.tsx
- src/components/translatable-mail-body.tsx
- src/lib/demo-outbox.test.ts
- src/lib/demo-storage.ts
- src/lib/i18n.test.ts
- src/lib/i18n.ts
- src/lib/mail-image-decorations.test.ts
- src/lib/mail-image-resources.ts
- src/lib/mail-translation.test.ts
- src/lib/mail-translation.ts
- src/lib/preview-api.test.ts
- src/lib/preview-bridge.ts
- src/lib/rich-body.test.ts
- src/lib/rich-image-size.test.ts
- src/lib/translation-activity.test.ts
- src/locales/config.json
- src/locales/en.json
- src/locales/zh-CN.json
- src/preview-main.tsx

### 本地独有（自研 / 上游没走的路）

- scripts/upstream-matrix.mjs
- src-tauri/capabilities/compose-window.json
- src-tauri/capabilities/mail-window.json
- src/components/compose-attachments.test.tsx
- src/components/compose-attachments.tsx
- src/components/compose-window.test.tsx
- src/components/compose-window.tsx
- src/components/drafts-panel.tsx
- src/components/inbox-scope.test.tsx
- src/components/inbox-scope.tsx
- src/components/mail-reader-window.test.tsx
- src/components/mail-reader-window.tsx
- src/components/move-to-folder-menu.tsx
- src/components/pending-send.test.tsx
- src/components/pending-send.tsx
- src/components/remove-account-dialog.test.tsx
- src/components/remove-account-dialog.tsx
- src/components/rich-image-zoom.tsx
- src/components/rules-dialog-layout.test.ts
- src/components/scroll-pane.test.tsx
- src/components/scroll-pane.tsx
- src/components/ui/button-group.tsx
- src/lib/compose-fonts.ts
- src/lib/fonts.ts
- src/lib/greeting-paragraph.test.ts
- src/lib/greeting-paragraph.ts
- src/lib/indented-paragraph.test.ts
- src/lib/indented-paragraph.ts
- src/lib/mail-menu.test.ts
- src/lib/mail-menu.ts

### 改名候选


### 双方不同：行数差最大的 25 个

| 文件 | 上游行数 | 本地行数 | 差 |
| --- | --- | --- | --- |
| src-tauri/src/lib.rs | 1710 | 3273 | 1563 |
| src-tauri/src/tests.rs | 2731 | 4211 | 1480 |
| src/App.tsx | 3223 | 4541 | 1318 |
| src-tauri/src/store.rs | 1219 | 2224 | 1005 |
| src/index.css | 3775 | 4621 | 846 |
| src/components/compose-dialog.tsx | 1135 | 1713 | 578 |
| src/components/storage-tools.tsx | 216 | 794 | 578 |
| src/components/compose-dialog.test.tsx | 450 | 1022 | 572 |
| src-tauri/src/rule_runs.rs | 1299 | 841 | 458 |
| src/components/storage-tools.test.tsx | 118 | 451 | 333 |
| src/lib/compose-format.test.ts | 201 | 500 | 299 |
| src-tauri/src/rule_operations.rs | 433 | 726 | 293 |
| src/components/rich-editor.test.tsx | 248 | 517 | 269 |
| src/App.test.tsx | 2556 | 2330 | 226 |
| src/components/mail-attachments.tsx | 125 | 318 | 193 |
| src-tauri/src/archive.rs | 515 | 706 | 191 |
| src/components/mail-content.tsx | 217 | 408 | 191 |
| src-tauri/src/paging.rs | 1100 | 919 | 181 |
| src/components/mail-content-loading.test.tsx | 262 | 90 | 172 |
| src/components/mail-attachments.test.tsx | 107 | 269 | 162 |
| src/components/app-updates.test.tsx | 395 | 247 | 148 |
| src/components/mail-signatures.test.tsx | 109 | 229 | 120 |
| src/components/remote-folder-list.tsx | 282 | 165 | 117 |
| src-tauri/src/network.rs | 6626 | 6526 | 100 |
| src/components/rich-editor.tsx | 358 | 458 | 100 |
