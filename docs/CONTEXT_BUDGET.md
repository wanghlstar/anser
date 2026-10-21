# 上下文预算与工具输出规则

用于减少重复的 LLM 上下文开销。目标：单次请求上下文尽量低于 15 万 token，而不是接近模型上限。

## 默认规则

1. 开发中只跑目标测试；全量前端/Rust 测试只在阶段末或发布前跑一次。
2. 工具输出默认不超过 80 行；超限先写临时文件，再用 `rg` / `tail` 提取。
3. 禁止直接把完整测试日志、完整 diff、完整 AX 树、截图放进上下文。
4. 读文件先 `rg -n` 定位，再 `sed -n '起,止p'`；不要整文件反复读。
5. 独立命令并行执行，减少回合数；每回合都会重新发送上下文。
6. 每完成一个闭环立即 `/dcp-compress`；跨功能直接新开会话。
7. 交接只记录结论、文件路径、命令和待办，不复述过程日志。

## 命令示例

```bash
# 只跑目标测试
cargo test --manifest-path src-tauri/Cargo.toml --lib auth::tests 2>&1 | tail -20
npx vitest run src/components/recipient-input.test.tsx

# 全量门禁：只保留结果和失败
cargo test --manifest-path src-tauri/Cargo.toml --lib 2>&1 \
  | rg 'test result|FAILED|panicked|error\['
npx vitest run --reporter=dot

# 构建日志落盘，只看尾部
npx tauri build --bundles app > /tmp/build.log 2>&1
tail -20 /tmp/build.log

# diff 先看统计，再看单文件
git diff --stat
git diff -- src-tauri/src/auth.rs

# 定位代码
rg -n -C 3 'load_with' src-tauri/src/auth.rs
sed -n '230,250p' src-tauri/src/auth.rs

# 大日志/AX 输出先过滤
some-command > /tmp/output.txt 2>&1
rg -n 'error|FAILED|收件人|416|keychain' /tmp/output.txt | head -40
```

## 例外

- 测试失败时，完整日志可以写 `/tmp`，但只把失败摘要和前后约 30 行读入上下文。
- 需要对照大段上游代码时，只读目标 hunk，不整文件搬运。
- 图片/截图只有在必须看视觉结果时使用；能用 DOM 尺寸、测试断言或文本日志代替时优先替代。

## 背景

2026-10-21 的用量约为 195 次调用、44.47M prompt token、162k completion token，平均每次约 22.8 万 prompt token。主要来源是长测试日志、完整 diff、AX dump 和重复回传历史。把平均上下文压到 10–15 万，可显著降低成本和首 token 延迟。
