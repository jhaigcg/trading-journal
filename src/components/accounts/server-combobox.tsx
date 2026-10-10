"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { suggestServers } from "@/lib/brokers/servers";

const input = "min-h-11 w-full rounded-control border border-line-strong bg-inset px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";

/**
 * A text box that suggests broker server names as you type. Type two or three letters of the broker or the server
 * (for example "icm" or "pepper"), then pick one with the mouse or the arrow keys and Enter. Anything you type is
 * accepted, so a server that is not in the list still works.
 */
export function ServerCombobox({ name = "server", mine = [], required = true }: { name?: string; mine?: string[]; required?: boolean }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const options = useMemo(() => suggestServers(value, mine), [value, mine]);
  const show = open && options.length > 0;

  const pick = (server: string) => {
    setValue(server);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        name={name}
        value={value}
        required={required}
        maxLength={80}
        autoComplete="off"
        spellCheck={false}
        placeholder="Type a few letters, e.g. icm"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show ? `${listId}-${active}` : undefined}
        className={input}
        onChange={(e) => {
          setValue(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && show) {
            e.preventDefault(); // choose the suggestion instead of submitting the form
            pick(options[Math.min(active, options.length - 1)].server);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {show && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-control border border-line-strong bg-card p-1 shadow-xl">
          {options.map((o, i) => (
            <li
              key={o.server}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: the input would lose focus and close the list before a click registered
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.server);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded px-2.5 text-[13px]", i === active ? "bg-nav-active text-ink" : "text-ink-2")}
            >
              <span className="num truncate">{o.server}</span>
              <span className="shrink-0 text-xs text-muted">{o.broker}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
