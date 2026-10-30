import type { ReactNode } from "react";

/// 列表和阅读标题里的纯文本高亮；正文 iframe 单独处理。
export function Highlight({
  text,
  query,
}: {
  text: string;
  query?: string;
}): ReactNode {
  const term = query?.trim();
  if (!term || term.length > 200) return text;
  const lower = text.toLocaleLowerCase();
  const needle = term.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  let marks = 0;
  while (marks < 100) {
    const index = lower.indexOf(needle, start);
    if (index < 0) break;
    if (index > start) parts.push(text.slice(start, index));
    parts.push(
      <mark className="search-hit" key={`${index}-${parts.length}`}>
        {text.slice(index, index + term.length)}
      </mark>,
    );
    start = index + term.length;
    marks += 1;
  }
  if (!parts.length) return text;
  if (start < text.length) parts.push(text.slice(start));
  return <>{parts}</>;
}
