import { useCommandAria } from "@/hooks/use-command-aria";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Command, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { addressTokens, formatAddress, parseAddresses } from "@/lib/addresses";
import type { Address } from "@/lib/types";

export function RecipientInput({
  id,
  value,
  onChange,
  suggestions,
  autoFocus = false,
}: {
  id: string;
  value: string;
  onChange: (s: string) => void;
  suggestions: Address[];
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [expanded, setExpanded] = useState(false),
    [visibleCount, setVisibleCount] = useState(0),
    [layoutVersion, setLayoutVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const tokens = addressTokens(value);
  const completed = tokens.slice(0, -1).filter(Boolean);
  const completedKey = completed.join("\u0000");
  const current = tokens.at(-1) || "";
  const chips =
    completed.length > 0 &&
    completed.every((token) => parseAddresses(token).length === 1);
  const shownCount = Math.min(visibleCount, completed.length);
  const collapsed = chips && !expanded && shownCount < completed.length;
  const shown = collapsed ? completed.slice(0, shownCount) : completed;
  // Recipients fill the row before folding. Measure every chip off-screen so
  // the visible count does not depend on a magic recipient count.
  useLayoutEffect(() => {
    if (!chips || expanded) {
      setVisibleCount(completed.length);
      return;
    }
    const root = rootRef.current;
    const measure = measureRef.current;
    if (!root || !measure) return;
    const width = root.clientWidth;
    if (!width) {
      // Layout is unavailable (for example in jsdom); keep everything visible.
      setVisibleCount(completed.length);
      return;
    }
    const widths = [
      ...measure.querySelectorAll<HTMLElement>("[data-measure-chip]"),
    ].map((chip) => chip.getBoundingClientRect().width);
    const moreWidth =
      measure
        .querySelector<HTMLElement>("[data-measure-more]")
        ?.getBoundingClientRect().width ?? 0;
    const gap = 6;
    const available = width - 96 - gap;
    const total =
      widths.reduce((sum, chip) => sum + chip, 0) +
      Math.max(0, widths.length - 1) * gap;
    if (total <= available) {
      setVisibleCount(completed.length);
      return;
    }
    let used = 0;
    let count = 0;
    for (const chip of widths) {
      const next = used + (count ? gap : 0) + chip;
      if (next + gap + moreWidth > available) break;
      used = next;
      count += 1;
    }
    setVisibleCount(count);
  }, [chips, completed.length, completedKey, expanded, layoutVersion]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setLayoutVersion((version) => version + 1),
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const term = (tokens.at(-1) || "").toLowerCase();
  const used = new Set(
    parseAddresses(tokens.slice(0, -1).join(",")).map((a) =>
      a.email.toLowerCase(),
    ),
  );
  const options = term
    ? suggestions
        .filter(
          (a) =>
            !used.has(a.email.toLowerCase()) &&
            `${a.name} ${a.email}`.toLowerCase().includes(term),
        )
        .slice(0, 6)
    : [];
  const aria = useCommandAria(
    open && options.length > 0,
    active,
    value,
    options.length,
  );
  function choose(address: Address) {
    onChange([...completed, formatAddress(address)].join(", ") + ", ");
    setOpen(false);
    setActive(0);
  }
  function remove(index: number) {
    onChange([...completed.filter((_, i) => i !== index), current].join(", "));
  }
  return (
    <Popover open={open && options.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          ref={rootRef}
          className={`recipient-input ${chips ? "with-chips" : ""} ${collapsed ? "collapsed" : ""} ${expanded ? "expanded" : ""}`}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            inputRef.current?.focus();
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setExpanded(false);
          }}
        >
          {chips && !expanded && (
            <div
              ref={measureRef}
              className="recipient-measure"
              aria-hidden="true"
            >
              {completed.map((token, index) => (
                <span
                  className="recipient-chip"
                  data-measure-chip
                  key={`measure-${index}`}
                >
                  <span>
                    {parseAddresses(token)[0]?.name ||
                      parseAddresses(token)[0]?.email ||
                      token}
                  </span>
                  <span className="recipient-chip-x">×</span>
                </span>
              ))}
              <span className="recipient-chip recipient-more" data-measure-more>
                +{completed.length}
              </span>
            </div>
          )}
          {chips && (
            <div className="recipient-chips">
              {shown.map((token, index) => {
                const address = parseAddresses(token)[0];
                const label = address.name || address.email;
                return (
                  <span className="recipient-chip" title={token} key={index}>
                    <span>{label}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`移除收件人 ${label}`}
                      onClick={() => remove(index)}
                    >
                      ×
                    </Button>
                  </span>
                );
              })}
              {collapsed && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="recipient-chip recipient-more"
                  aria-label={`展开另外 ${completed.length - shownCount} 个收件人`}
                  onClick={() => setExpanded(true)}
                >
                  +{completed.length - shownCount}
                </Button>
              )}
            </div>
          )}
          <Input
            ref={inputRef}
            id={id}
            autoFocus={autoFocus}
            value={chips ? current : value}
            autoComplete="off"
            placeholder={chips ? "添加收件人" : "多个地址用逗号分隔"}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && options.length > 0}
            aria-controls={aria.controls}
            aria-activedescendant={aria.activeDescendant}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(e) => {
              onChange(
                chips
                  ? [...completed, e.target.value].join(", ")
                  : e.target.value,
              );
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (!open || !options.length) return;
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive(
                  (i) =>
                    (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
                    options.length,
                );
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                choose(options[Math.min(active, options.length - 1)]);
              }
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-max min-w-72 max-w-[min(416px,var(--radix-popover-content-available-width))] p-1"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if ((e.target as HTMLElement).id === id) e.preventDefault();
        }}
      >
        <Command
          label="收件人建议"
          shouldFilter={false}
          value={options[Math.min(active, options.length - 1)]?.email}
          onValueChange={(email) => {
            const index = options.findIndex((a) => a.email === email);
            if (index >= 0) setActive(index);
          }}
        >
          <CommandList ref={aria.listRef}>
            {options.map((a, i) => (
              <CommandItem
                key={a.email}
                value={a.email}
                ref={(element) => aria.itemRef(i, element)}
                className="flex-col items-start gap-0.5"
                onMouseDown={(e) => e.preventDefault()}
                onSelect={() => choose(a)}
              >
                <strong>{a.name || a.email}</strong>
                <small className="text-muted-foreground">{a.email}</small>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
