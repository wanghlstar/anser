import { useCommandAria } from "@/hooks/use-command-aria";
import { useRef, useState } from "react";
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
    [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tokens = addressTokens(value);
  const completed = tokens.slice(0, -1).filter(Boolean);
  const current = tokens.at(-1) || "";
  const chips =
    completed.length > 0 &&
    completed.every((token) => parseAddresses(token).length === 1);
  const collapsed = chips && completed.length > 3 && !expanded;
  const shown = collapsed ? completed.slice(0, 2) : completed;
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
          className={`recipient-input ${chips ? "with-chips" : ""} ${collapsed ? "collapsed" : ""}`}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            if (!expanded) {
              setExpanded(true);
              inputRef.current?.focus();
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setExpanded(false);
          }}
        >
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
                  aria-label={`展开另外 ${completed.length - 2} 个收件人`}
                  onClick={() => setExpanded(true)}
                >
                  +{completed.length - 2}
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
            onFocus={() => {
              setExpanded(true);
              setOpen(true);
            }}
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
        className="w-[var(--radix-popover-trigger-width)] min-w-72 p-1"
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
