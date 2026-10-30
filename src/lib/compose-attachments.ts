export function mergeAttachmentPaths(existing: string[], incoming: string[]) {
  if (incoming.some((path) => !path || path.includes("\0")))
    throw new Error("附件路径无效，未添加文件");
  return [
    ...new Set([
      ...existing,
      ...incoming.filter((path) => !!path && !path.includes("\0")),
    ]),
  ];
}
// 主题还空着时，用第一个附件的文件名（去掉扩展名）当主题：从 Finder 粘/拖
// 文件进来通常是「发个文件」，不填主题会一直被拦在发送前。
export function attachmentSubject(subject: string, paths: string[]) {
  if (subject.trim()) return subject;
  const name = (paths[0]?.split("/").pop() || "").trim();
  const dot = name.lastIndexOf(".");
  // 只去掉真正的扩展名：`.gitignore` 这类以点开头的文件名保持原样。
  return dot > 0 ? name.slice(0, dot) : name;
}
export function insideComposeDrop(
  position: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number },
  scale: number,
) {
  if (!Number.isFinite(scale) || scale <= 0) return false;
  const x = position.x / scale,
    y = position.y / scale;
  return (
    x >= bounds.left &&
    x <= bounds.right &&
    y >= bounds.top &&
    y <= bounds.bottom
  );
}

// 从剪贴板取出「复制的文件」路径：Finder 复制文件时提供 text/uri-list(file://)。
// 退回 text/plain 且形如绝对路径的情况（部分来源只给 POSIX 路径）。
export function attachmentPathsFromClipboard(clipboard: DataTransfer | null) {
  if (!clipboard) return [];
  const toPath = (value: string) => {
    const text = value.trim();
    if (!text || text.startsWith("#")) return "";
    if (text.startsWith("file://")) {
      try {
        return decodeURIComponent(new URL(text).pathname);
      } catch {
        return "";
      }
    }
    return text.startsWith("/") && !text.includes("\0") ? text : "";
  };
  const paths = clipboard
    .getData("text/uri-list")
    .split(/\r?\n/)
    .map(toPath)
    .filter(Boolean);
  if (paths.length) return paths;
  const single = toPath(clipboard.getData("text/plain"));
  return single ? [single] : [];
}
