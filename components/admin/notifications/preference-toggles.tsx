"use client";

import { useState, useTransition } from "react";

export type ToggleRow<K extends string> = { key: K; label: string; hint: string };

export type TogglesCopy = {
  heading: string;
  description: string;
  auto: string;
  saving: string;
  saved: string;
};

/**
 * A set of notification switches, saved as they are flipped (§11.2, §11.9).
 *
 * Shared by the owner's six types and the platform's seven, with the rows and every string
 * passed in — the two audiences have different types, different wording and, deliberately,
 * different languages.
 *
 * Saved immediately rather than behind a Save button, like the section switches in the content
 * editor: a settings page with a Save button is a settings page people leave without pressing
 * it, and then wonder why nothing changed.
 *
 * `highlighted` is for a switch that changes what leaves the building rather than what arrives
 * (the order amount, D50): it is rendered apart, with its own warning, because presenting it as
 * one more item in a list of feature switches is the quiet way to get it turned on.
 */
export function PreferenceToggles<K extends string>({
  rows,
  values,
  copy,
  save,
  highlighted,
}: {
  rows: readonly ToggleRow<K>[];
  values: Record<K, boolean>;
  copy: TogglesCopy;
  save: (next: Record<K, boolean>) => Promise<unknown>;
  highlighted?: { row: ToggleRow<K>; warning: string };
}) {
  const [current, setCurrent] = useState(values);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const toggle = (key: K) => {
    const next = { ...current, [key]: !current[key] };
    setCurrent(next);
    setSaved(false);
    startTransition(async () => {
      await save(next);
      setSaved(true);
    });
  };

  const row = (entry: ToggleRow<K>) => (
    <div key={entry.key} className="flex items-start justify-between gap-4">
      <label className="grid gap-0.5 text-sm" htmlFor={`pref-${entry.key}`}>
        <span className="font-medium">{entry.label}</span>
        <span className="text-xs text-muted-foreground">{entry.hint}</span>
      </label>
      <input
        id={`pref-${entry.key}`}
        name={entry.key}
        type="checkbox"
        checked={!!current[entry.key]}
        disabled={pending}
        onChange={() => toggle(entry.key)}
        className="mt-1 size-4"
      />
    </div>
  );

  return (
    <section className="grid gap-4 rounded-lg border p-4" data-testid="notification-types">
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">{copy.heading}</h2>
        <p className="text-sm text-muted-foreground">{copy.description}</p>
      </div>

      <div className="grid gap-3">{rows.map(row)}</div>

      {highlighted ? (
        <div className="grid gap-2 rounded-md bg-muted/50 p-3">
          {row(highlighted.row)}
          <p className="text-xs text-muted-foreground">{highlighted.warning}</p>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground" role="status">
        {pending ? copy.saving : saved ? copy.saved : copy.auto}
      </p>
    </section>
  );
}
