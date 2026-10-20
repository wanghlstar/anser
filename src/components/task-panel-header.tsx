import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { CardHeader } from "./ui/card";
import { CollapsibleTrigger } from "./ui/collapsible";

export function TaskPanelHeader({
  title,
  description,
  onRefresh,
  action,
  disabled = false,
  controls,
  compact = false,
}: {
  title: string;
  description: ReactNode;
  onRefresh?: () => Promise<void>;
  action?: ReactNode;
  disabled?: boolean;
  controls?: string;
  compact?: boolean;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const pending = useRef(false);
  const live = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  async function refresh() {
    if (!onRefresh || pending.current) return;
    pending.current = true;
    setRefreshing(true);
    const started = performance.now();
    try {
      await onRefresh();
    } catch (error) {
      if (live.current) toast.error(String(error));
    } finally {
      // Keep even a fast local read visible; never delay publishing fresh data.
      if (live.current) {
        timer.current = setTimeout(
          () => {
            pending.current = false;
            setRefreshing(false);
          },
          Math.max(0, 600 - (performance.now() - started)),
        );
      }
    }
  }

  return (
    <CardHeader className="flex flex-row items-start gap-2 px-4">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          aria-label={`展开或收起${title}`}
          aria-controls={controls}
          disabled={disabled}
          className={cn(
            "group h-auto min-w-0 flex-1 items-start justify-start gap-4 px-2 text-left whitespace-normal",
            compact ? "py-0.5" : "py-1",
          )}
        >
          <span
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              compact ? "gap-1" : "gap-2",
            )}
          >
            <span className="font-semibold">{title}</span>
            <span
              className={cn(
                "leading-relaxed font-normal text-muted-foreground",
                compact ? "text-xs" : "text-sm",
              )}
            >
              {description}
            </span>
          </span>
          <ChevronDown className="mt-0.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
        </Button>
      </CollapsibleTrigger>
      {(onRefresh || action) && (
        <div className="flex min-w-[88px] shrink-0 items-center justify-start gap-2">
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`刷新${title}`}
              aria-busy={refreshing}
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw
                data-icon="inline-start"
                className={cn(
                  refreshing && "animate-spin motion-reduce:animate-none",
                )}
              />
              <span aria-live="polite">{refreshing ? "刷新中" : "刷新"}</span>
            </Button>
          )}
          {action}
        </div>
      )}
    </CardHeader>
  );
}
