import { useEffect, useRef, useState } from "react";
import { call } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import { Card, CardContent, CardFooter } from "./ui/card";
import { TaskPanelHeader } from "./task-panel-header";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";

export type RuleRun = {
  id: string;
  accountEmail: string;
  subject: string;
  step: string;
  cursor: number;
  total: number;
  applied: number;
  status: string;
  error: string;
  updatedAt: string;
};
const states: Record<string, string> = {
  queued: "待处理",
  running: "核对与处理",
  paused: "已暂停",
  blocked: "需要处理",
  completed: "步骤已处理",
  cancelled: "已取消",
};
export function RuleRunsPanel({ onShowTasks }: { onShowTasks?: () => void }) {
  const [items, setItems] = useState<RuleRun[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(false),
    reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let live = true;
    const update = coalesceRefresh(async () => {
      try {
        const rows = await call<RuleRun[]>("rule_runs");
        if (live) {
          setItems(rows);
          setError("");
        }
      } catch (e) {
        if (live) setError(String(e));
      }
    });
    reload.current = update;
    void update();
    const timer = setInterval(() => void update(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  async function action(id: string, kind: string) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    try {
      await call("rule_run_action", { id, action: kind });
      await reload.current();
    } catch (e) {
      setError(String(e));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  const pending =
    items?.filter((item) => !["completed", "cancelled"].includes(item.status))
      .length ?? 0;
  return (
    <Collapsible defaultOpen={false} asChild>
      <Card>
        <TaskPanelHeader
          title="规则处理任务"
          description={`最近 100 项，当前 ${pending} 项待处理。在线正文按需核对；完整保存成功后再归类。`}
          onRefresh={() => reload.current()}
          inlineAction={
            <Badge
              variant={
                items?.some((item) => item.status === "blocked")
                  ? "destructive"
                  : "secondary"
              }
            >
              {pending} 项待处理
            </Badge>
          }
        />
        <CollapsibleContent asChild>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!items && !error && (
              <Skeleton className="h-16" aria-label="正在加载规则任务" />
            )}
            {items?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                暂无需要异步处理的规则。涉及在线正文或完整保存时，任务会显示在这里。
              </p>
            )}
            {items?.map((item) => (
              <div key={item.id} className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words" title={item.subject}>
                      {item.subject}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.accountEmail} · 已检查 {item.cursor}/{item.total}{" "}
                      项，匹配 {item.applied} 项
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.status === "completed" ? "最后检查" : "当前步骤"}：
                      {item.step || "规则检查"}
                    </p>
                  </div>
                  <Badge
                    variant={
                      item.status === "blocked" ? "destructive" : "secondary"
                    }
                  >
                    {states[item.status] || item.status}
                  </Badge>
                </div>
                {item.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{item.error}</AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap gap-2">
                  {["queued", "running"].includes(item.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void action(item.id, "pause")}
                    >
                      暂停
                    </Button>
                  )}
                  {item.status === "paused" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void action(item.id, "resume")}
                    >
                      继续
                    </Button>
                  )}
                  {item.status === "blocked" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void action(item.id, "retry")}
                    >
                      重新核对并执行剩余规则
                    </Button>
                  )}
                  {!["completed", "cancelled"].includes(item.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void action(item.id, "cancel")}
                    >
                      取消剩余规则
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
        <CollapsibleContent asChild>
          <CardFooter className="flex flex-wrap gap-3">
            <p className="text-sm text-muted-foreground">
              已保存原件保留。重新核对会以当前标记和归类为起点执行剩余规则；服务器动作的实际结果需查看关联任务。
            </p>
            {onShowTasks && (
              <Button variant="outline" size="sm" onClick={onShowTasks}>
                查看保存与服务器任务
              </Button>
            )}
          </CardFooter>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
