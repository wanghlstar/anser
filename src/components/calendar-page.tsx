import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  format,
  isAfter,
  isBefore,
  isSameDay,
  parse,
  startOfDay,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  FileDown,
  FileUp,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { call, isDemo } from "@/lib/api";
import { eventsToIcs, parseIcs } from "@/lib/ics";
import {
  CALENDAR_COLORS,
  REMINDER_OPTIONS,
  REPEAT_OPTIONS,
  WEEKDAY_LABELS,
  allDaySpanLabel,
  dateAtMinutes,
  dateKey,
  daysForView,
  eventsForDay,
  formatMinutes,
  formatRangeTitle,
  layoutDayEvents,
  moveAnchor,
  occurrenceLabel,
  parseEventEnd,
  parseEventStart,
  rangeForView,
  snapMinutes,
  type CalendarView,
} from "@/lib/calendar";
import type {
  CalendarColor,
  CalendarEvent,
  CalendarOccurrence,
  CalendarRepeat,
} from "@/lib/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = [0, 15, 30, 45];
const COLOR_STORAGE_KEY = "yanxin-calendar-hidden-colors";

type DialogState = {
  key: number;
  event: CalendarEvent;
  isNew: boolean;
  series: boolean;
  occurrence: CalendarOccurrence | null;
};

type DragState = {
  id: number;
  kind: "create" | "move" | "resize" | "all-day";
  originDay: number;
  pointerX: number;
  pointerY: number;
  startMinutes: number;
  endMinutes: number;
  occurrence?: CalendarOccurrence;
  moved: boolean;
  preview: { dayIndex: number; startMinutes: number; endMinutes: number };
};

function parseEventDateTime(event: CalendarEvent): { start: Date; end: Date } {
  return {
    start: event.allDay
      ? parse(event.start, "yyyy-MM-dd", new Date())
      : new Date(event.start),
    end: event.allDay
      ? parse(event.end, "yyyy-MM-dd", new Date())
      : new Date(event.end),
  };
}

function newEvent(start: Date, end: Date, allDay = false): CalendarEvent {
  return {
    id: "",
    title: "",
    start: allDay ? dateKey(start) : start.toISOString(),
    end: allDay ? dateKey(end) : end.toISOString(),
    allDay,
    location: "",
    notes: "",
    color: "blue",
    reminderMinutes: 15,
    repeat: "none",
    createdAt: "",
    updatedAt: "",
  };
}

function loadHiddenColors(): CalendarColor[] {
  try {
    const stored = JSON.parse(
      localStorage.getItem(COLOR_STORAGE_KEY) || "[]",
    ) as CalendarColor[];
    return stored.filter((color) =>
      CALENDAR_COLORS.some((item) => item.value === color),
    );
  } catch {
    return [];
  }
}

export function CalendarPage({
  seed,
  onSeedConsumed,
}: {
  seed: CalendarEvent | null;
  onSeedConsumed: () => void;
}) {
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [occurrences, setOccurrences] = useState<CalendarOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [hiddenColors, setHiddenColors] =
    useState<CalendarColor[]>(loadHiddenColors);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingSeries, setPendingSeries] = useState<CalendarEvent | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<CalendarOccurrence | null>(
    null,
  );
  const [now, setNow] = useState(() => new Date());
  const dialogKey = useRef(0);
  const dragId = useRef(0);
  const dayAreaRef = useRef<HTMLDivElement | null>(null);
  const allDayRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const finishDragRef = useRef<(state: DragState) => void>(() => {});
  dragRef.current = drag;

  const range = useMemo(() => rangeForView(view, anchor), [view, anchor]);
  const days = useMemo(() => daysForView(view, anchor), [view, anchor]);
  const visible = useMemo(
    () =>
      occurrences.filter((item) => !hiddenColors.includes(item.event.color)),
    [occurrences, hiddenColors],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void call<CalendarOccurrence[]>("list_calendar_events", {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    })
      .then((items) => {
        if (alive) setOccurrences(items);
      })
      .catch((reason) => {
        if (alive) setError(String(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range.from, range.to, reload]);

  useEffect(() => {
    if (!seed) return;
    const start = parseEventStart(seed);
    setAnchor(start);
    setSelected(start);
    dialogKey.current += 1;
    setDialog({
      key: dialogKey.current,
      event: seed,
      isNew: true,
      series: false,
      occurrence: null,
    });
    onSeedConsumed();
  }, [seed, onSeedConsumed]);

  useEffect(() => {
    if (view === "month" || !scrollRef.current) return;
    scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
  }, [view]);

  useEffect(() => {
    const current = drag;
    if (!current) return;
    const move = (event: PointerEvent) => {
      const state = dragRef.current;
      if (!state) return;
      const dx = event.clientX - state.pointerX;
      const dy = event.clientY - state.pointerY;
      const moved = state.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3;
      if (state.kind === "all-day") {
        const rect = allDayRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = rect.width / days.length;
        const dayIndex = Math.max(
          0,
          Math.min(
            days.length - 1,
            Math.floor((event.clientX - rect.left) / width),
          ),
        );
        setDrag({
          ...state,
          moved,
          preview: { ...state.preview, dayIndex },
        });
        return;
      }
      const rect = dayAreaRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = rect.width / days.length;
      const dayIndex = Math.max(
        0,
        Math.min(
          days.length - 1,
          Math.floor((event.clientX - rect.left) / width),
        ),
      );
      const minutes = snapMinutes(
        ((event.clientY - rect.top) / HOUR_HEIGHT) * 60,
      );
      if (state.kind === "move") {
        const delta = snapMinutes(
          ((event.clientY - state.pointerY) / HOUR_HEIGHT) * 60,
        );
        const duration = state.endMinutes - state.startMinutes;
        const start = Math.max(
          0,
          Math.min(24 * 60 - duration, state.startMinutes + delta),
        );
        setDrag({
          ...state,
          moved,
          preview: {
            dayIndex,
            startMinutes: start,
            endMinutes: start + duration,
          },
        });
      } else if (state.kind === "resize") {
        const delta = snapMinutes(
          ((event.clientY - state.pointerY) / HOUR_HEIGHT) * 60,
        );
        setDrag({
          ...state,
          moved,
          preview: {
            dayIndex: state.originDay,
            startMinutes: state.startMinutes,
            endMinutes: Math.max(
              state.startMinutes + 15,
              state.endMinutes + delta,
            ),
          },
        });
      } else {
        let start = state.startMinutes;
        let end = minutes;
        if (end <= start) {
          start = Math.min(start, end);
          end = Math.max(state.startMinutes + 15, minutes + 15);
        }
        setDrag({
          ...state,
          moved,
          preview: {
            dayIndex: state.originDay,
            startMinutes: start,
            endMinutes: Math.max(end, start + 15),
          },
        });
      }
    };
    const up = () => {
      const state = dragRef.current;
      setDrag(null);
      if (state) finishDragRef.current(state);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag?.id, days.length]);

  useEffect(() => {
    localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(hiddenColors));
  }, [hiddenColors]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        dialog
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="combobox"], [data-slot="calendar"], [data-radix-popper-content-wrapper]',
        )
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        openCreate(selected);
      } else if (key === "t") {
        event.preventDefault();
        selectDay(new Date());
      } else if (key === "d") {
        event.preventDefault();
        setView("day");
      } else if (key === "w") {
        event.preventDefault();
        setView("week");
      } else if (key === "m") {
        event.preventDefault();
        setView("month");
      } else if (key === "l") {
        event.preventDefault();
        setView("list");
      } else if (key === "arrowleft") {
        event.preventDefault();
        setAnchor((value) => moveAnchor(view, value, -1));
      } else if (key === "arrowright") {
        event.preventDefault();
        setAnchor((value) => moveAnchor(view, value, 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dialog, selected, view]);

  function openCreate(day: Date, startMinutes = 9 * 60, endMinutes = 10 * 60) {
    const start = dateAtMinutes(day, startMinutes);
    const end = dateAtMinutes(day, endMinutes);
    dialogKey.current += 1;
    setDialog({
      key: dialogKey.current,
      event: newEvent(start, end),
      isNew: true,
      series: false,
      occurrence: null,
    });
  }

  function openEdit(occurrence: CalendarOccurrence) {
    const series = occurrence.event.repeat !== "none";
    dialogKey.current += 1;
    setDialog({
      key: dialogKey.current,
      event: { ...occurrence.event },
      isNew: false,
      series,
      occurrence,
    });
  }

  async function persist(event: CalendarEvent) {
    await call<CalendarEvent>("save_calendar_event", { event });
    setReload((value) => value + 1);
  }

  function finishDrag(state: DragState) {
    if (state.kind === "create") {
      const day = days[state.preview.dayIndex];
      if (!state.moved) {
        openCreate(day, state.startMinutes, state.startMinutes + 60);
        return;
      }
      openCreate(day, state.preview.startMinutes, state.preview.endMinutes);
      return;
    }
    if (!state.occurrence) return;
    if (!state.moved) {
      openEdit(state.occurrence);
      return;
    }
    const occurrence = state.occurrence;
    const repeating = occurrence.event.repeat !== "none";
    if (state.kind === "all-day") {
      const deltaDays = state.preview.dayIndex - state.originDay;
      if (deltaDays === 0) return;
      const original = parseEventDateTime(occurrence.event);
      const event: CalendarEvent = {
        ...occurrence.event,
        start: dateKey(addDays(original.start, deltaDays)),
        end: dateKey(addDays(original.end, deltaDays)),
      };
      if (repeating) {
        setPendingSeries(event);
        return;
      }
      void persist(event).catch((reason) => toast.error(String(reason)));
      return;
    }
    if (state.kind === "move") {
      const deltaDays = state.preview.dayIndex - state.originDay;
      const original = parseEventDateTime(occurrence.event);
      const newStart = dateAtMinutes(
        addDays(original.start, deltaDays),
        state.preview.startMinutes,
      );
      const duration = original.end.getTime() - original.start.getTime();
      const event: CalendarEvent = {
        ...occurrence.event,
        start: newStart.toISOString(),
        end: new Date(newStart.getTime() + duration).toISOString(),
      };
      if (repeating) {
        setPendingSeries(event);
        return;
      }
      void persist(event).catch((reason) => toast.error(String(reason)));
      return;
    }
    const original = parseEventDateTime(occurrence.event);
    const event: CalendarEvent = {
      ...occurrence.event,
      end: dateAtMinutes(
        original.start,
        state.preview.endMinutes,
      ).toISOString(),
    };
    if (repeating) {
      setPendingSeries(event);
      return;
    }
    void persist(event).catch((reason) => toast.error(String(reason)));
  }
  finishDragRef.current = finishDrag;

  async function removeOccurrence(
    occurrence: CalendarOccurrence,
    scope: "single" | "series",
  ) {
    try {
      if (scope === "single" && occurrence.event.repeat !== "none") {
        await call("skip_calendar_occurrence", {
          eventId: occurrence.event.id,
          occurrenceStart: occurrence.start,
        });
      } else {
        await call("delete_calendar_event", { id: occurrence.event.id });
      }
      setDeleteTarget(null);
      setReload((value) => value + 1);
      toast.success(scope === "single" ? "已删除这一次日程" : "日程已删除");
    } catch (reason) {
      toast.error(String(reason));
    }
  }

  async function duplicateOccurrence(occurrence: CalendarOccurrence) {
    try {
      await persist({
        ...occurrence.event,
        id: "",
        title: `${occurrence.event.title}（副本）`,
        createdAt: "",
        updatedAt: "",
      });
      toast.success("日程已复制");
    } catch (reason) {
      toast.error(String(reason));
    }
  }

  async function exportIcs() {
    if (isDemo()) {
      toast.error("演示模式不支持导出 ICS");
      return;
    }
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        filters: [{ name: "iCalendar", extensions: ["ics"] }],
        defaultPath: `雁信日历-${dateKey(new Date())}.ics`,
        title: "导出日历",
      });
      if (!path) return;
      const events = await call<CalendarEvent[]>("all_calendar_events");
      if (!events.length) {
        toast.error("没有可导出的日程");
        return;
      }
      await call("write_text_file", {
        path,
        content: eventsToIcs(events),
      });
      toast.success(`已导出 ${events.length} 条日程`);
    } catch (reason) {
      toast.error(String(reason));
    }
  }

  async function importIcs() {
    if (isDemo()) {
      toast.error("演示模式不支持导入 ICS");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        multiple: false,
        filters: [{ name: "iCalendar", extensions: ["ics"] }],
        title: "选择 ICS 文件",
      });
      if (!path || typeof path !== "string") return;
      const text = await call<string>("read_text_file", { path });
      const events = parseIcs(text);
      if (!events.length) {
        toast.error("文件中没有可导入的日程");
        return;
      }
      for (const event of events) {
        await call("save_calendar_event", { event });
      }
      setReload((value) => value + 1);
      toast.success(`已导入 ${events.length} 条日程`);
    } catch (reason) {
      toast.error(String(reason));
    }
  }

  function beginCreate(dayIndex: number, event: React.PointerEvent) {
    if (event.button !== 0) return;
    const rect = dayAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const minutes = snapMinutes(
      ((event.clientY - rect.top) / HOUR_HEIGHT) * 60,
    );
    const id = ++dragId.current;
    setDrag({
      id,
      kind: "create",
      originDay: dayIndex,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startMinutes: minutes,
      endMinutes: minutes + 15,
      moved: false,
      preview: {
        dayIndex,
        startMinutes: minutes,
        endMinutes: minutes + 15,
      },
    });
  }

  function beginMove(
    occurrence: CalendarOccurrence,
    dayIndex: number,
    event: React.PointerEvent,
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const day = parseEventStart(occurrence);
    const startMinutes = Math.max(0, day.getHours() * 60 + day.getMinutes());
    const end = parseEventEnd(occurrence);
    const duration = Math.max(15, (end.getTime() - day.getTime()) / 60_000);
    const endMinutes = Math.min(24 * 60, startMinutes + duration);
    const id = ++dragId.current;
    setDrag({
      id,
      kind: "move",
      originDay: dayIndex,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startMinutes,
      endMinutes,
      occurrence,
      moved: false,
      preview: { dayIndex, startMinutes, endMinutes },
    });
  }

  function beginResize(
    occurrence: CalendarOccurrence,
    dayIndex: number,
    event: React.PointerEvent,
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const day = parseEventStart(occurrence);
    const startMinutes = day.getHours() * 60 + day.getMinutes();
    const end = parseEventEnd(occurrence);
    const endMinutes = Math.min(
      24 * 60,
      Math.max(startMinutes + 15, end.getHours() * 60 + end.getMinutes()),
    );
    const id = ++dragId.current;
    setDrag({
      id,
      kind: "resize",
      originDay: dayIndex,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startMinutes,
      endMinutes,
      occurrence,
      moved: false,
      preview: { dayIndex, startMinutes, endMinutes },
    });
  }

  function beginAllDayMove(
    occurrence: CalendarOccurrence,
    dayIndex: number,
    event: React.PointerEvent,
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const id = ++dragId.current;
    setDrag({
      id,
      kind: "all-day",
      originDay: dayIndex,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startMinutes: 0,
      endMinutes: 0,
      occurrence,
      moved: false,
      preview: { dayIndex, startMinutes: 0, endMinutes: 0 },
    });
  }

  function selectDay(day: Date) {
    setSelected(day);
    setAnchor(day);
  }

  return (
    <section className="workspace-panel calendar-workspace">
      <div className="calendar-toolbar">
        <div className="calendar-toolbar-main">
          <Button onClick={() => openCreate(selected)}>
            <Plus />
            新建日程
          </Button>
          <Button variant="outline" onClick={() => selectDay(new Date())}>
            今天
          </Button>
          <div className="calendar-arrows">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="上一段时间"
              onClick={() => setAnchor((value) => moveAnchor(view, value, -1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="下一段时间"
              onClick={() => setAnchor((value) => moveAnchor(view, value, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          <h1 className="calendar-title">{formatRangeTitle(view, anchor)}</h1>
        </div>
        <div className="calendar-toolbar-actions">
          <div
            className="calendar-view-switch"
            role="group"
            aria-label="日历视图"
          >
            {(
              [
                ["day", "日"],
                ["week", "周"],
                ["month", "月"],
                ["list", "列表"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                variant={view === value ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="更多日历操作"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void importIcs()}>
                <FileUp />
                导入 ICS
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportIcs()}>
                <FileDown />
                导出 ICS
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="calendar-body">
        <aside className="calendar-side">
          <Calendar
            mode="single"
            locale={zhCN}
            selected={selected}
            month={anchor}
            onMonthChange={setAnchor}
            onSelect={(day) => day && selectDay(day)}
            className="calendar-mini"
          />
          <div className="calendar-colors">
            <h2>日历分类</h2>
            {CALENDAR_COLORS.map((color) => {
              const checked = !hiddenColors.includes(color.value);
              return (
                <Label key={color.value} className="calendar-color-row">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) =>
                      setHiddenColors((current) =>
                        next === true
                          ? current.filter((item) => item !== color.value)
                          : [...current, color.value],
                      )
                    }
                  />
                  <span
                    className={cn(
                      "calendar-color-dot",
                      `calendar-tone-${color.value}`,
                    )}
                  />
                  <span>{color.label}</span>
                </Label>
              );
            })}
          </div>
        </aside>
        <div className="calendar-main">
          {error ? (
            <div className="calendar-empty">{error}</div>
          ) : view === "month" ? (
            <MonthGrid
              days={days}
              occurrences={visible}
              selected={selected}
              loading={loading}
              onSelect={selectDay}
              onCreate={openCreate}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onDuplicate={duplicateOccurrence}
              onShowMore={(day) => {
                selectDay(day);
                setView("day");
              }}
            />
          ) : view === "list" ? (
            <ListView
              occurrences={visible}
              loading={loading}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onDuplicate={duplicateOccurrence}
            />
          ) : (
            <TimeGrid
              days={days}
              occurrences={visible}
              loading={loading}
              now={now}
              drag={drag}
              dayAreaRef={dayAreaRef}
              allDayRef={allDayRef}
              scrollRef={scrollRef}
              onSelectDay={selectDay}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onDuplicate={duplicateOccurrence}
              onBeginCreate={beginCreate}
              onBeginMove={beginMove}
              onBeginResize={beginResize}
              onBeginAllDayMove={beginAllDayMove}
            />
          )}
        </div>
      </div>
      {dialog && (
        <EventEditor
          key={dialog.key}
          event={dialog.event}
          occurrence={dialog.occurrence}
          isNew={dialog.isNew}
          series={dialog.series}
          onClose={() => setDialog(null)}
          onSave={async (event, scope) => {
            if (scope === "single" && dialog.series && dialog.occurrence) {
              await call<CalendarEvent>("save_calendar_event", { event });
              await call("skip_calendar_occurrence", {
                eventId: dialog.occurrence.event.id,
                occurrenceStart: dialog.occurrence.start,
              });
              setReload((value) => value + 1);
            } else {
              await persist(event);
            }
            setDialog(null);
            toast.success(
              scope === "single" && dialog.series
                ? "已保存这一次日程"
                : "日程已保存",
            );
          }}
          onDelete={
            dialog.isNew
              ? undefined
              : async (event, scope) => {
                  if (scope === "single" && dialog.occurrence) {
                    await call("skip_calendar_occurrence", {
                      eventId: dialog.occurrence.event.id,
                      occurrenceStart: dialog.occurrence.start,
                    });
                  } else {
                    await call("delete_calendar_event", { id: event.id });
                  }
                  setReload((value) => value + 1);
                  setDialog(null);
                  toast.success(
                    scope === "single" ? "已删除这一次日程" : "日程已删除",
                  );
                }
          }
        />
      )}
      <AlertDialog
        open={pendingSeries !== null}
        onOpenChange={(open) => !open && setPendingSeries(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>调整整个重复日程？</AlertDialogTitle>
            <AlertDialogDescription>
              拖拽会同时调整整个系列。若只想修改这一次，请双击该日程后在编辑窗口选择「仅此日程」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingSeries) return;
                const event = pendingSeries;
                setPendingSeries(null);
                void persist(event)
                  .then(() => toast.success("重复日程已调整"))
                  .catch((reason) => toast.error(String(reason)));
              }}
            >
              调整整个系列
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.event.repeat !== "none"
                ? "删除重复日程"
                : "删除日程"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.event.repeat !== "none"
                ? "可以只删除选中的这一次，也可以删除整个重复系列。"
                : `确定删除「${deleteTarget?.event.title ?? ""}」？删除后无法恢复。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            {deleteTarget?.event.repeat !== "none" && (
              <AlertDialogAction
                className="border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  if (deleteTarget)
                    void removeOccurrence(deleteTarget, "single");
                }}
              >
                仅这一次
              </AlertDialogAction>
            )}
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) void removeOccurrence(deleteTarget, "series");
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function MonthGrid({
  days,
  occurrences,
  selected,
  loading,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onDuplicate,
  onShowMore,
}: {
  days: Date[];
  occurrences: CalendarOccurrence[];
  selected: Date;
  loading: boolean;
  onSelect: (day: Date) => void;
  onCreate: (day: Date) => void;
  onEdit: (occurrence: CalendarOccurrence) => void;
  onDelete: (occurrence: CalendarOccurrence) => void;
  onDuplicate: (occurrence: CalendarOccurrence) => void;
  onShowMore: (day: Date) => void;
}) {
  const today = new Date();
  return (
    <div className="calendar-month">
      <div className="calendar-month-head">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="calendar-month-grid">
        {days.map((day) => {
          const items = eventsForDay(occurrences, day);
          const shown = items.slice(0, 3);
          const outside = day.getMonth() !== days[15].getMonth();
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "calendar-month-cell",
                outside && "outside",
                isSameDay(day, today) && "today",
                isSameDay(day, selected) && "selected",
              )}
              onClick={() => onSelect(day)}
              onDoubleClick={() => onCreate(day)}
            >
              <div className="calendar-day-number">{format(day, "d")}</div>
              <div className="calendar-pills">
                {shown.map((occurrence) => (
                  <EventContextMenu
                    key={occurrence.key}
                    occurrence={occurrence}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onDuplicate={onDuplicate}
                  >
                    <Button
                      variant="ghost"
                      size="xs"
                      className={cn(
                        "calendar-pill",
                        `calendar-tone-${occurrence.event.color}`,
                      )}
                      title={`${occurrence.event.title} · ${occurrenceLabel(occurrence)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(occurrence);
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      {!occurrence.allDay && (
                        <span>
                          {format(parseEventStart(occurrence), "HH:mm")}
                        </span>
                      )}
                      <strong>{occurrence.event.title}</strong>
                    </Button>
                  </EventContextMenu>
                ))}
                {items.length > shown.length && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="calendar-more"
                    onClick={(event) => {
                      event.stopPropagation();
                      onShowMore(day);
                    }}
                  >
                    还有 {items.length - shown.length} 项
                  </Button>
                )}
              </div>
              {loading && items.length === 0 && (
                <span className="calendar-cell-loading" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventContextMenu({
  occurrence,
  onEdit,
  onDelete,
  onDuplicate,
  children,
}: {
  occurrence: CalendarOccurrence;
  onEdit: (occurrence: CalendarOccurrence) => void;
  onDelete: (occurrence: CalendarOccurrence) => void;
  onDuplicate: (occurrence: CalendarOccurrence) => void;
  children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onEdit(occurrence)}>
          <Pencil />
          编辑日程
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onDuplicate(occurrence)}>
          <Copy />
          复制日程
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => onDelete(occurrence)}
        >
          <Trash2 />
          删除日程
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ListView({
  occurrences,
  loading,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  occurrences: CalendarOccurrence[];
  loading: boolean;
  onEdit: (occurrence: CalendarOccurrence) => void;
  onDelete: (occurrence: CalendarOccurrence) => void;
  onDuplicate: (occurrence: CalendarOccurrence) => void;
}) {
  const today = new Date();
  const groups = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>();
    for (const occurrence of occurrences) {
      const key = dateKey(parseEventStart(occurrence));
      const items = map.get(key) ?? [];
      items.push(occurrence);
      map.set(key, items);
    }
    return [...map.entries()];
  }, [occurrences]);

  if (loading && !occurrences.length) {
    return <div className="calendar-empty">正在加载日程…</div>;
  }
  if (!groups.length) {
    return <div className="calendar-empty">这段时间没有日程</div>;
  }
  return (
    <div className="calendar-list">
      {groups.map(([key, items]) => {
        const date = items[0] ? parseEventStart(items[0]) : new Date(key);
        return (
          <section className="calendar-list-day" key={key}>
            <header className="calendar-list-date">
              <strong>{format(date, "M月d日")}</strong>
              <span>{WEEKDAY_LABELS[(date.getDay() + 6) % 7]}</span>
              {isSameDay(date, today) && (
                <span className="calendar-list-today">今天</span>
              )}
            </header>
            <div className="calendar-list-rows">
              {items.map((occurrence) => (
                <EventContextMenu
                  key={occurrence.key}
                  occurrence={occurrence}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                >
                  <Button
                    variant="ghost"
                    className="calendar-list-row"
                    onClick={() => onEdit(occurrence)}
                  >
                    <span
                      className={cn(
                        "calendar-list-dot",
                        `calendar-tone-${occurrence.event.color}`,
                      )}
                    />
                    <span className="calendar-list-time">
                      {occurrence.allDay
                        ? "全天"
                        : format(parseEventStart(occurrence), "HH:mm")}
                    </span>
                    <span className="calendar-list-main">
                      <strong>{occurrence.event.title}</strong>
                      {occurrence.event.location && (
                        <small>
                          <MapPin /> {occurrence.event.location}
                        </small>
                      )}
                    </span>
                    {occurrence.event.repeat !== "none" && (
                      <Repeat className="calendar-list-repeat" />
                    )}
                  </Button>
                </EventContextMenu>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TimeGrid({
  days,
  occurrences,
  loading,
  now,
  drag,
  dayAreaRef,
  allDayRef,
  scrollRef,
  onSelectDay,
  onEdit,
  onDelete,
  onDuplicate,
  onBeginCreate,
  onBeginMove,
  onBeginResize,
  onBeginAllDayMove,
}: {
  days: Date[];
  occurrences: CalendarOccurrence[];
  loading: boolean;
  now: Date;
  drag: DragState | null;
  dayAreaRef: React.RefObject<HTMLDivElement | null>;
  allDayRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onSelectDay: (day: Date) => void;
  onEdit: (occurrence: CalendarOccurrence) => void;
  onDelete: (occurrence: CalendarOccurrence) => void;
  onDuplicate: (occurrence: CalendarOccurrence) => void;
  onBeginCreate: (dayIndex: number, event: React.PointerEvent) => void;
  onBeginMove: (
    occurrence: CalendarOccurrence,
    dayIndex: number,
    event: React.PointerEvent,
  ) => void;
  onBeginResize: (
    occurrence: CalendarOccurrence,
    dayIndex: number,
    event: React.PointerEvent,
  ) => void;
  onBeginAllDayMove: (
    occurrence: CalendarOccurrence,
    dayIndex: number,
    event: React.PointerEvent,
  ) => void;
}) {
  const today = new Date();
  return (
    <div className="calendar-time">
      <div
        className="calendar-allday"
        style={{
          gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        <div className="calendar-allday-label">全天</div>
        <div
          className="calendar-allday-cells"
          ref={allDayRef}
          style={{
            gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          {days.map((day, index) => {
            const items = eventsForDay(occurrences, day).filter(
              (item) => item.allDay,
            );
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "calendar-allday-cell",
                  drag?.kind === "all-day" &&
                    drag.preview.dayIndex === index &&
                    "drop",
                )}
                onClick={() => onSelectDay(day)}
              >
                {items.map((occurrence) => (
                  <EventContextMenu
                    key={occurrence.key}
                    occurrence={occurrence}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onDuplicate={onDuplicate}
                  >
                    <Button
                      variant="ghost"
                      size="xs"
                      className={cn(
                        "calendar-pill",
                        `calendar-tone-${occurrence.event.color}`,
                      )}
                      title={`${occurrence.event.title} · ${allDaySpanLabel(occurrence)}`}
                      onPointerDown={(event) =>
                        onBeginAllDayMove(occurrence, index, event)
                      }
                      onDoubleClick={() => onEdit(occurrence)}
                    >
                      <strong>{occurrence.event.title}</strong>
                    </Button>
                  </EventContextMenu>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="calendar-time-head">
        <div className="calendar-time-gutter" />
        <div
          className="calendar-time-heads"
          style={{
            gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          {days.map((day) => (
            <Button
              variant="ghost"
              size="sm"
              key={day.toISOString()}
              className={cn(
                "calendar-day-head",
                isSameDay(day, today) && "today",
              )}
              onClick={() => onSelectDay(day)}
            >
              <span>{WEEKDAY_LABELS[(day.getDay() + 6) % 7]}</span>
              <strong>{format(day, "M/d")}</strong>
            </Button>
          ))}
        </div>
      </div>
      <div className="calendar-time-scroll" ref={scrollRef}>
        <div className="calendar-time-content">
          <div className="calendar-hour-gutter">
            {HOURS.map((hour) => (
              <span key={hour} style={{ height: HOUR_HEIGHT }}>
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <div
            className="calendar-day-area"
            ref={dayAreaRef}
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            {days.map((day, index) => {
              const positioned = layoutDayEvents(occurrences, day);
              const isToday = isSameDay(day, now);
              return (
                <div
                  key={day.toISOString()}
                  className="calendar-day-column"
                  onPointerDown={(event) => onBeginCreate(index, event)}
                >
                  {positioned.map((item) => (
                    <EventContextMenu
                      key={item.occurrence.key}
                      occurrence={item.occurrence}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onDuplicate={onDuplicate}
                    >
                      <Button
                        variant="ghost"
                        className={cn(
                          "calendar-event-block",
                          `calendar-tone-${item.occurrence.event.color}`,
                        )}
                        style={{
                          top: (item.startMinutes / 60) * HOUR_HEIGHT,
                          height: Math.max(
                            ((item.endMinutes - item.startMinutes) / 60) *
                              HOUR_HEIGHT,
                            18,
                          ),
                          left: `${(item.column / item.columns) * 100}%`,
                          width: `${100 / item.columns}%`,
                        }}
                        onPointerDown={(event) =>
                          onBeginMove(item.occurrence, index, event)
                        }
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          onEdit(item.occurrence);
                        }}
                      >
                        <strong>{item.occurrence.event.title}</strong>
                        <span>
                          {formatMinutes(item.startMinutes)} –{" "}
                          {formatMinutes(item.endMinutes)}
                        </span>
                        {item.occurrence.event.location && (
                          <small>
                            <MapPin /> {item.occurrence.event.location}
                          </small>
                        )}
                        <span
                          className="calendar-resize-handle"
                          onPointerDown={(event) =>
                            onBeginResize(item.occurrence, index, event)
                          }
                        />
                      </Button>
                    </EventContextMenu>
                  ))}
                  {drag &&
                    drag.kind !== "all-day" &&
                    drag.preview.dayIndex === index && (
                      <div
                        className="calendar-event-preview"
                        style={{
                          top: (drag.preview.startMinutes / 60) * HOUR_HEIGHT,
                          height: Math.max(
                            ((drag.preview.endMinutes -
                              drag.preview.startMinutes) /
                              60) *
                              HOUR_HEIGHT,
                            10,
                          ),
                        }}
                      >
                        {formatMinutes(drag.preview.startMinutes)} –{" "}
                        {formatMinutes(drag.preview.endMinutes)}
                      </div>
                    )}
                  {isToday && (
                    <div
                      className="calendar-now-line"
                      style={{
                        top:
                          ((now.getHours() * 60 + now.getMinutes()) / 60) *
                          HOUR_HEIGHT,
                      }}
                    />
                  )}
                  {loading && positioned.length === 0 && (
                    <span className="calendar-cell-loading" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function DateField({
  value,
  onChange,
  disabledBefore,
  label,
}: {
  value: Date;
  onChange: (date: Date) => void;
  disabledBefore?: Date;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="calendar-date-button"
          aria-label={label}
        >
          <CalendarDays />
          {format(value, "yyyy年M月d日")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={zhCN}
          selected={value}
          disabled={
            disabledBefore ? { before: startOfDay(disabledBefore) } : undefined
          }
          onSelect={(day) => {
            if (!day) return;
            const next = new Date(day);
            next.setHours(value.getHours(), value.getMinutes(), 0, 0);
            onChange(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function TimeSelect({
  value,
  onChange,
  label,
}: {
  value: Date;
  onChange: (date: Date) => void;
  label: string;
}) {
  const setPart = (hours: number, minutes: number) => {
    const next = new Date(value);
    next.setHours(hours, minutes, 0, 0);
    onChange(next);
  };
  return (
    <div className="calendar-time-select" aria-label={label}>
      <Clock />
      <Select
        value={String(value.getHours())}
        onValueChange={(next) => setPart(Number(next), value.getMinutes())}
      >
        <SelectTrigger aria-label={`${label}小时`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOURS.map((hour) => (
            <SelectItem key={hour} value={String(hour)}>
              {String(hour).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span>:</span>
      <Select
        value={String(value.getMinutes())}
        onValueChange={(next) => setPart(value.getHours(), Number(next))}
      >
        <SelectTrigger aria-label={`${label}分钟`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map((minute) => (
            <SelectItem key={minute} value={String(minute)}>
              {String(minute).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EventEditor({
  event,
  occurrence,
  isNew,
  series,
  onClose,
  onSave,
  onDelete,
}: {
  event: CalendarEvent;
  occurrence: CalendarOccurrence | null;
  isNew: boolean;
  series: boolean;
  onClose: () => void;
  onSave: (event: CalendarEvent, scope: "single" | "series") => Promise<void>;
  onDelete?: (
    event: CalendarEvent,
    scope: "single" | "series",
  ) => Promise<void>;
}) {
  const initial = occurrence
    ? { start: parseEventStart(occurrence), end: parseEventEnd(occurrence) }
    : parseEventDateTime(event);
  const [title, setTitle] = useState(event.title);
  const [allDay, setAllDay] = useState(event.allDay);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [scope, setScope] = useState<"single" | "series">(
    series ? "single" : "series",
  );
  const [location, setLocation] = useState(event.location);
  const [notes, setNotes] = useState(event.notes);
  const [color, setColor] = useState<CalendarColor>(event.color);
  const [reminder, setReminder] = useState(
    event.reminderMinutes === null ? "none" : String(event.reminderMinutes),
  );
  const [repeat, setRepeat] = useState<CalendarRepeat>(event.repeat);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    if (next) {
      setStart(startOfDay(start));
      setEnd(startOfDay(end));
    } else {
      const nextStart = startOfDay(start);
      nextStart.setHours(9, 0, 0, 0);
      setStart(nextStart);
      setEnd(addMinutes(nextStart, 60));
    }
  }

  function changeStart(next: Date) {
    const previous = start;
    setStart(next);
    if (allDay) {
      if (isBefore(end, next)) setEnd(next);
      return;
    }
    const duration = Math.max(end.getTime() - previous.getTime(), 15 * 60_000);
    if (!isAfter(end, next)) {
      setEnd(new Date(next.getTime() + duration));
    }
  }

  function changeEnd(next: Date) {
    setEnd(next);
    if (allDay ? isBefore(next, start) : !isAfter(next, start)) {
      setStart(allDay ? next : new Date(next.getTime() - 60 * 60_000));
    }
  }

  async function submit() {
    if (!title.trim()) {
      setError("请填写日程标题");
      return;
    }
    if (allDay) {
      if (isBefore(startOfDay(end), startOfDay(start))) {
        setError("结束日期不能早于开始日期");
        return;
      }
    } else if (!isAfter(end, start)) {
      setError("结束时间需晚于开始时间");
      return;
    }
    setError("");
    setSaving(true);
    let payload: CalendarEvent;
    if (scope === "single" && series && occurrence) {
      payload = {
        ...event,
        id: "",
        title: title.trim(),
        allDay,
        start: allDay ? dateKey(start) : start.toISOString(),
        end: allDay ? dateKey(end) : end.toISOString(),
        location,
        notes,
        color,
        reminderMinutes: reminder === "none" ? null : Number(reminder),
        repeat: "none",
        createdAt: "",
        updatedAt: "",
      };
    } else if (scope === "series" && series && occurrence) {
      const base = parseEventDateTime(event);
      const occurrenceStart = parseEventStart(occurrence);
      let seriesStart: Date;
      let seriesEnd: Date;
      if (!event.allDay && !allDay) {
        const delta = start.getTime() - occurrenceStart.getTime();
        seriesStart = new Date(base.start.getTime() + delta);
        seriesEnd = new Date(
          seriesStart.getTime() + (end.getTime() - start.getTime()),
        );
      } else if (event.allDay && allDay) {
        const delta = differenceInCalendarDays(start, occurrenceStart);
        seriesStart = addDays(base.start, delta);
        const duration = differenceInCalendarDays(end, start);
        seriesEnd = addDays(seriesStart, duration);
      } else {
        seriesStart = start;
        seriesEnd = end;
      }
      payload = {
        ...event,
        title: title.trim(),
        allDay,
        start: allDay ? dateKey(seriesStart) : seriesStart.toISOString(),
        end: allDay ? dateKey(seriesEnd) : seriesEnd.toISOString(),
        location,
        notes,
        color,
        reminderMinutes: reminder === "none" ? null : Number(reminder),
        repeat,
      };
    } else {
      payload = {
        ...event,
        title: title.trim(),
        allDay,
        start: allDay ? dateKey(start) : start.toISOString(),
        end: allDay ? dateKey(end) : end.toISOString(),
        location,
        notes,
        color,
        reminderMinutes: reminder === "none" ? null : Number(reminder),
        repeat,
      };
    }
    try {
      await onSave(payload, scope);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="calendar-dialog">
        <DialogHeader>
          <DialogTitle>{isNew ? "新建日程" : "编辑日程"}</DialogTitle>
          <DialogDescription>
            {series
              ? "默认只修改这一次；选择「整个系列」会同步所有重复实例。"
              : "时间按本地时区显示，提醒仅在雁信运行时弹出。"}
          </DialogDescription>
        </DialogHeader>
        <div className="calendar-form">
          <div className="calendar-form-row">
            <Label htmlFor="calendar-title">标题</Label>
            <Input
              id="calendar-title"
              value={title}
              autoFocus
              placeholder="例如：项目周会"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <Label className="calendar-form-check">
            <Checkbox
              checked={allDay}
              onCheckedChange={(next) => toggleAllDay(next === true)}
            />
            <span>全天</span>
          </Label>
          {series && (
            <div className="calendar-form-row">
              <Label>修改范围</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={scope}
                onValueChange={(next) =>
                  next && setScope(next as "single" | "series")
                }
              >
                <ToggleGroupItem value="single">仅此日程</ToggleGroupItem>
                <ToggleGroupItem value="series">整个系列</ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          <div className="calendar-form-row">
            <Label>开始</Label>
            <div className="calendar-form-dates">
              <DateField
                value={start}
                onChange={changeStart}
                label="开始日期"
              />
              {!allDay && (
                <TimeSelect
                  value={start}
                  onChange={changeStart}
                  label="开始时间"
                />
              )}
            </div>
          </div>
          <div className="calendar-form-row">
            <Label>结束</Label>
            <div className="calendar-form-dates">
              <DateField
                value={end}
                onChange={changeEnd}
                disabledBefore={allDay ? startOfDay(start) : start}
                label="结束日期"
              />
              {!allDay && (
                <TimeSelect value={end} onChange={changeEnd} label="结束时间" />
              )}
            </div>
          </div>
          <div className="calendar-form-row">
            <Label htmlFor="calendar-location">地点</Label>
            <Input
              id="calendar-location"
              value={location}
              placeholder="可选"
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>
          <div className="calendar-form-row">
            <Label>颜色</Label>
            <div className="calendar-swatches">
              {CALENDAR_COLORS.map((item) => (
                <Button
                  key={item.value}
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "calendar-swatch",
                    `calendar-tone-${item.value}`,
                    color === item.value && "active",
                  )}
                  aria-label={item.label}
                  aria-pressed={color === item.value}
                  onClick={() => setColor(item.value)}
                />
              ))}
            </div>
          </div>
          <div className="calendar-form-grid">
            <div className="calendar-form-row">
              <Label>提醒</Label>
              <Select value={reminder} onValueChange={setReminder}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_OPTIONS.map((item) => (
                    <SelectItem
                      key={item.value === null ? "none" : item.value}
                      value={item.value === null ? "none" : String(item.value)}
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="calendar-form-row">
              <Label>重复</Label>
              <Select
                value={repeat}
                onValueChange={(next) => setRepeat(next as CalendarRepeat)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEAT_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="calendar-form-row">
            <Label htmlFor="calendar-notes">备注</Label>
            <Textarea
              id="calendar-notes"
              value={notes}
              rows={4}
              placeholder="可选"
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          {error && <p className="calendar-form-error">{error}</p>}
        </div>
        <DialogFooter className="calendar-dialog-footer">
          {!isNew && onDelete && (
            <Button
              type="button"
              variant="ghost"
              className="calendar-delete"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
              删除
            </Button>
          )}
          <div className="calendar-dialog-actions">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogFooter>
        {onDelete && (
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {series ? "删除重复日程？" : "删除这个日程？"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {series
                    ? "可以只删除当前这一次，也可以删除整个重复系列。删除后无法恢复。"
                    : "删除后无法恢复。"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                {series ? (
                  <>
                    <AlertDialogAction
                      className="border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        setConfirmDelete(false);
                        void onDelete(event, "single");
                      }}
                    >
                      仅此日程
                    </AlertDialogAction>
                    <AlertDialogAction
                      onClick={() => {
                        setConfirmDelete(false);
                        void onDelete(event, "series");
                      }}
                    >
                      整个系列
                    </AlertDialogAction>
                  </>
                ) : (
                  <AlertDialogAction
                    onClick={() => {
                      setConfirmDelete(false);
                      void onDelete(event, "series");
                    }}
                  >
                    删除
                  </AlertDialogAction>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
