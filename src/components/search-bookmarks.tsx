import { useEffect, useState } from "react";
import { Bookmark, BookmarkPlus, History, Search, Trash2 } from "lucide-react";
import type { Query } from "@/lib/types";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export type SavedSearch = {
  id: string;
  name: string;
  query: Query;
};
const SAVED_KEY = "mail-saved-searches";
const RECENT_KEY = "mail-recent-searches";

function load(key: string): SavedSearch[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter(
          (item): item is SavedSearch =>
            !!item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            !!item.query &&
            typeof item.query.search === "string",
        )
      : [];
  } catch {
    return [];
  }
}
function store(key: string, items: SavedSearch[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // 本地存储不可用时仍允许本次会话使用。
  }
}
const FIELD_LABELS: Record<string, string> = {
  subject: "主题",
  sender: "发件人",
  recipients: "收件人",
  body: "全文",
  attachments: "附件名",
};
function fieldsLabel(fields: string[] | undefined) {
  return (fields ?? []).map((field) => FIELD_LABELS[field]).filter(Boolean);
}
function searchLabel(query: Query) {
  const mainFields = query.searchFields?.length
    ? query.searchFields
    : query.searchField
      ? [query.searchField]
      : [];
  const main = query.search.trim()
    ? `${mainFields.length ? fieldsLabel(mainFields).join("/") : "全文"} “${query.search.trim()}”`
    : "";
  const conditions = query.searchConditions ?? [];
  const firstCondition = conditions[0];
  const first = firstCondition
    ? `${fieldsLabel(firstCondition.fields).join("/") || "全文"} “${firstCondition.value}”`
    : "";
  const label = [main, first].filter(Boolean).join(" · ");
  const extra = conditions.length > 1 ? ` +${conditions.length - 1}` : "";
  return label ? label + extra : "筛选搜索";
}
function hasConditions(query: Query) {
  return Boolean(
    query.search.trim() ||
    query.searchFields?.length ||
    query.searchConditions?.length ||
    query.starredOnly ||
    query.attachmentsOnly ||
    query.searchField ||
    query.dateFrom ||
    query.dateBefore,
  );
}
function summary(query: Query) {
  const bits: string[] = [];
  const mainFields = query.searchFields?.length
    ? query.searchFields
    : query.searchField
      ? [query.searchField]
      : [];
  if (query.search.trim())
    bits.push(
      `${mainFields.length ? fieldsLabel(mainFields).join("/") : "全文"} “${query.search.trim()}”`,
    );
  for (const condition of query.searchConditions ?? []) {
    const fields = fieldsLabel(condition.fields);
    bits.push(
      `${fields.length ? fields.join("/") : "全文"} “${condition.value}”`,
    );
  }
  if (query.starredOnly) bits.push("星标");
  if (query.attachmentsOnly) bits.push("有附件");
  if (query.unreadOnly || query.view === "unread") bits.push("未读");
  if (query.dateFrom || query.dateBefore) bits.push("日期范围");
  return bits.filter(Boolean).join(" · ") || "全部邮件";
}

export function SearchBookmarks({
  query,
  onApply,
}: {
  query: Query;
  onApply: (query: Query) => void;
}) {
  const [saved, setSaved] = useState<SavedSearch[]>(() => load(SAVED_KEY));
  const [recent, setRecent] = useState<SavedSearch[]>(() => load(RECENT_KEY));

  function remember(next: Query) {
    const key = JSON.stringify({ ...next, limit: 0 });
    setRecent((current) => {
      const item: SavedSearch = {
        id: crypto.randomUUID(),
        name: searchLabel(next),
        query: { ...next, limit: 200 },
      };
      const list = [
        item,
        ...current.filter(
          (saved) => JSON.stringify({ ...saved.query, limit: 0 }) !== key,
        ),
      ].slice(0, 8);
      store(RECENT_KEY, list);
      return list;
    });
  }

  useEffect(() => {
    if (!hasConditions(query)) return;
    const timer = setTimeout(() => remember(query), 1500);
    return () => clearTimeout(timer);
    // 每个查询条件都单独触发；打字期间不清空输入，只重置计时。
  }, [
    query.search,
    query.searchField,
    query.searchFields,
    query.searchConditions,
    query.searchMode,
    query.accountId,
    query.folder,
    query.view,
    query.unreadOnly,
    query.starredOnly,
    query.attachmentsOnly,
    query.dateFrom,
    query.dateBefore,
  ]);

  function apply(next: SavedSearch) {
    onApply({ ...next.query, limit: 200 });
  }

  function saveCurrent() {
    if (!hasConditions(query)) return;
    const item: SavedSearch = {
      id: crypto.randomUUID(),
      name: searchLabel(query),
      query: { ...query, limit: 200 },
    };
    const list = [item, ...saved].slice(0, 12);
    setSaved(list);
    store(SAVED_KEY, list);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-lg" title="保存的搜索">
          <Bookmark />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuItem
          disabled={!hasConditions(query)}
          onSelect={saveCurrent}
        >
          <BookmarkPlus />
          保存当前搜索
        </DropdownMenuItem>
        {saved.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>已保存</DropdownMenuLabel>
            {saved.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={() => apply(item)}
                title={summary(item.query)}
              >
                <Bookmark />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {summary(item.query)}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                setSaved([]);
                store(SAVED_KEY, []);
              }}
            >
              <Trash2 />
              清空已保存搜索
            </DropdownMenuItem>
          </>
        )}
        {recent.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>最近搜索</DropdownMenuLabel>
            {recent.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={() => apply(item)}
                title={summary(item.query)}
              >
                <History />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {summary(item.query)}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {!saved.length && !recent.length && (
          <DropdownMenuItem disabled>
            <Search />
            搜索后会记录最近搜索
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
