import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarDays, X } from "lucide-react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function mailDateBounds(range: DateRange | undefined) {
  if (!range?.from) return { dateFrom: undefined, dateBefore: undefined };
  const from = new Date(range.from),
    before = new Date(range.to || range.from);
  from.setHours(0, 0, 0, 0);
  before.setHours(0, 0, 0, 0);
  before.setDate(before.getDate() + 1);
  return { dateFrom: from.toISOString(), dateBefore: before.toISOString() };
}
function selectedRange(from?: string, before?: string): DateRange | undefined {
  if (!from) return undefined;
  const to = before ? new Date(before) : new Date(from);
  if (before) to.setDate(to.getDate() - 1);
  return { from: new Date(from), to };
}
export function MailDateFilter({
  dateFrom,
  dateBefore,
  onChange,
}: {
  dateFrom?: string;
  dateBefore?: string;
  onChange: (range: { dateFrom?: string; dateBefore?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState(0);
  const [range, setRange] = useState<DateRange | undefined>(() =>
    selectedRange(dateFrom, dateBefore),
  );
  const current = selectedRange(dateFrom, dateBefore);
  const fromLabel = current?.from ? format(current.from, "yyyy/MM/dd") : "";
  const toLabel = current?.from
    ? format(current.to || current.from, "yyyy/MM/dd")
    : "";
  const label = fromLabel
    ? fromLabel === toLabel
      ? fromLabel
      : `${fromLabel} — ${toLabel}`
    : "时间";
  return (
    <div className="relative inline-flex">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setRange(selectedRange(dateFrom, dateBefore));
            setPicks(0);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant={dateFrom ? "secondary" : "outline"}
            size="sm"
            aria-label="按时间筛选邮件"
            title={label}
          >
            <CalendarDays data-icon="inline-start" />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <FieldGroup>
            <Field>
              <FieldLabel>时间</FieldLabel>
              <FieldDescription>
                先点开始日期，再点结束日期；使用本机时区，时间未知的邮件不参与筛选。
              </FieldDescription>
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => {
                  setRange(undefined);
                  setPicks(0);
                }}
              >
                重新选择
              </Button>
              <Calendar
                mode="range"
                selected={range}
                onSelect={(next) => {
                  if (!next?.from) {
                    setRange(undefined);
                    setPicks(0);
                    return;
                  }
                  const count = picks + 1;
                  setPicks(count);
                  setRange(next);
                  // 第一次点只定开始日期；第二次点结束日期后才应用。
                  if (count >= 2) {
                    onChange(mailDateBounds(next));
                    setOpen(false);
                    setPicks(0);
                  }
                }}
                locale={zhCN}
                captionLayout="dropdown"
                startMonth={new Date(1900, 0)}
                endMonth={new Date(2100, 11)}
                defaultMonth={range?.from}
                autoFocus
              />
            </Field>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  onChange({ dateFrom: undefined, dateBefore: undefined });
                  setOpen(false);
                  setPicks(0);
                }}
              >
                不限时间
              </Button>
            </div>
          </FieldGroup>
        </PopoverContent>
      </Popover>
      {dateFrom && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="清除时间筛选"
          title="清除时间筛选"
          className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full border bg-background p-0 shadow-sm"
          onClick={(event) => {
            event.stopPropagation();
            onChange({ dateFrom: undefined, dateBefore: undefined });
            setRange(undefined);
            setPicks(0);
          }}
        >
          <X size={10} />
        </Button>
      )}
    </div>
  );
}
